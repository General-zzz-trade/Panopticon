/**
 * Threat Intelligence — malware/phishing detection using free public feeds
 * No API keys — uses URLhaus, PhishTank, and direct checks
 */

import { execFileNoThrow } from "../utils/execFileNoThrow.js";

export interface ThreatResult {
  target: string;
  malicious: boolean;
  threats: ThreatEntry[];
  blacklists: BlacklistResult[];
  sslIssues: string[];
  suspiciousPatterns: string[];
  riskScore: number; // 0-100
  timestamp: string;
}

export interface ThreatEntry {
  source: string;
  type: "malware" | "phishing" | "botnet" | "spam" | "suspicious";
  description: string;
  firstSeen?: string;
  lastSeen?: string;
  confidence: number;
}

export interface BlacklistResult {
  name: string;
  listed: boolean;
  detail?: string;
}

// ── URLhaus (abuse.ch — free, no key) ───────────────────

export async function checkUrlhaus(target: string): Promise<ThreatEntry[]> {
  const threats: ThreatEntry[] = [];

  try {
    // Check domain/host
    const response = await fetch("https://urlhaus-api.abuse.ch/v1/host/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `host=${encodeURIComponent(target)}`,
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.query_status === "no_results") return threats;

      for (const url of (data.urls || []).slice(0, 20)) {
        threats.push({
          source: "URLhaus",
          type: url.threat === "malware_download" ? "malware" : "suspicious",
          description: `${url.url_status}: ${url.threat || "unknown"} — ${url.tags?.join(", ") || "no tags"}`,
          firstSeen: url.date_added,
          lastSeen: url.last_online,
          confidence: url.url_status === "online" ? 0.9 : 0.6,
        });
      }
    }
  } catch {}

  // Also check as URL if it looks like one
  if (target.startsWith("http")) {
    try {
      const response = await fetch("https://urlhaus-api.abuse.ch/v1/url/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `url=${encodeURIComponent(target)}`,
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.query_status === "ok" && data.id) {
          threats.push({
            source: "URLhaus",
            type: "malware",
            description: `Known malicious URL — threat: ${data.threat || "unknown"}, tags: ${(data.tags || []).join(", ")}`,
            firstSeen: data.date_added,
            confidence: 0.95,
          });
        }
      }
    } catch {}
  }

  return threats;
}

// ── PhishTank (free, no key for basic check) ────────────

export async function checkPhishTank(url: string): Promise<ThreatEntry[]> {
  const threats: ThreatEntry[] = [];

  try {
    const response = await fetch("https://checkurl.phishtank.com/checkurl/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `url=${encodeURIComponent(url)}&format=json`,
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.results?.in_database && data.results?.valid) {
        threats.push({
          source: "PhishTank",
          type: "phishing",
          description: `Confirmed phishing site — verified: ${data.results.verified ? "yes" : "no"}`,
          confidence: data.results.verified ? 0.95 : 0.7,
        });
      }
    }
  } catch {}

  return threats;
}

// ── DNS Blacklist (DNSBL) Check ─────────────────────────

const DNSBL_SERVERS = [
  { name: "Spamhaus ZEN", zone: "zen.spamhaus.org" },
  { name: "Spamhaus DBL", zone: "dbl.spamhaus.org" },
  { name: "SURBL", zone: "multi.surbl.org" },
  { name: "Barracuda", zone: "b.barracudacentral.org" },
  { name: "SpamCop", zone: "bl.spamcop.net" },
  { name: "SORBS", zone: "dnsbl.sorbs.net" },
  { name: "UCEPROTECT-1", zone: "dnsbl-1.uceprotect.net" },
];

export async function checkDnsBlacklists(ip: string): Promise<BlacklistResult[]> {
  const clean = ip.replace(/[^0-9.]/g, "");
  const parts = clean.split(".").reverse();
  if (parts.length !== 4) return [];

  const reversed = parts.join(".");
  const results: BlacklistResult[] = [];

  const checks = DNSBL_SERVERS.map(async (server) => {
    const lookup = `${reversed}.${server.zone}`;
    const { stdout } = await execFileNoThrow("dig", ["+short", lookup, "A"], { timeoutMs: 5000 });
    const trimmed = stdout.trim();
    const listed = !!trimmed && /^127\./.test(trimmed);

    results.push({
      name: server.name,
      listed,
      detail: listed ? trimmed : undefined,
    });
  });

  await Promise.all(checks);
  return results.sort((a, b) => (b.listed ? 1 : 0) - (a.listed ? 1 : 0));
}

// ── SSL/TLS Security Check ──────────────────────────────

export async function checkSslSecurity(domain: string): Promise<string[]> {
  const clean = domain.replace(/[^a-zA-Z0-9.\-]/g, "");
  const issues: string[] = [];

  try {
    // Use openssl to check certificate
    const { stdout, stderr } = await execFileNoThrow(
      "openssl",
      ["s_client", "-connect", `${clean}:443`, "-servername", clean, "-brief"],
      { timeoutMs: 10000 }
    );
    const combined = stdout + stderr;

    // Check protocol version
    if (combined.includes("TLSv1.0") || combined.includes("SSLv3")) {
      issues.push("Insecure TLS version (TLSv1.0 or SSLv3) supported");
    }

    // Check certificate expiry
    const { stdout: certOut } = await execFileNoThrow(
      "openssl",
      ["s_client", "-connect", `${clean}:443`, "-servername", clean],
      { timeoutMs: 10000 }
    );

    // Extract dates from certificate
    if (certOut.includes("BEGIN CERTIFICATE")) {
      const certBlock = certOut.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
      if (certBlock) {
        const { stdout: dateOut } = await execFileNoThrow(
          "bash",
          ["-c", `echo "${certBlock[0]}" | openssl x509 -noout -dates 2>/dev/null`],
          { timeoutMs: 5000 }
        );
        const notAfterMatch = dateOut.match(/notAfter=(.+)/);
        if (notAfterMatch) {
          const expiry = new Date(notAfterMatch[1]);
          const now = new Date();
          const daysLeft = Math.floor((expiry.getTime() - now.getTime()) / 86400000);

          if (daysLeft < 0) issues.push(`Certificate EXPIRED ${Math.abs(daysLeft)} days ago`);
          else if (daysLeft < 14) issues.push(`Certificate expires in ${daysLeft} days`);
        }
      }
    }

    // Self-signed check
    if (combined.includes("self signed") || combined.includes("self-signed")) {
      issues.push("Self-signed certificate detected");
    }

    // Verify result
    if (combined.includes("Verification error")) {
      const errMatch = combined.match(/Verification error: (.+)/);
      if (errMatch) issues.push(`Certificate verification error: ${errMatch[1]}`);
    }
  } catch {}

  return issues;
}

// ── Suspicious Pattern Detection ────────────────────────

export function detectSuspiciousPatterns(domain: string): string[] {
  const patterns: string[] = [];
  const d = domain.toLowerCase();

  // Homograph/typosquatting detection
  if (/xn--/.test(d)) patterns.push("Internationalized domain name (IDN) — possible homograph attack");
  if (/[0oO]{2,}|[1lI]{2,}/.test(d)) patterns.push("Confusable characters detected (possible typosquatting)");

  // Known brand impersonation patterns
  const brands = ["google", "facebook", "apple", "microsoft", "amazon", "paypal", "netflix", "instagram", "whatsapp", "telegram", "bank", "secure", "login", "verify", "update", "account"];
  for (const brand of brands) {
    if (d.includes(brand) && !d.endsWith(`.${brand}.com`) && !d.endsWith(`.${brand}.org`)) {
      // Check if it's not the actual domain
      const mainDomain = d.split(".").slice(-2).join(".");
      if (!mainDomain.startsWith(brand)) {
        patterns.push(`Contains brand name "${brand}" — possible impersonation/phishing`);
      }
    }
  }

  // Suspicious TLDs
  const suspiciousTlds = [".tk", ".ml", ".ga", ".cf", ".gq", ".top", ".xyz", ".buzz", ".rest", ".icu"];
  if (suspiciousTlds.some(tld => d.endsWith(tld))) {
    patterns.push(`Suspicious TLD: ${d.split(".").pop()} (commonly used for abuse)`);
  }

  // Very long subdomain (DGA-like)
  const labels = d.split(".");
  if (labels.some(l => l.length > 25)) {
    patterns.push("Unusually long subdomain label (possible DGA or data exfiltration)");
  }

  // Too many subdomains
  if (labels.length > 5) {
    patterns.push(`Excessive subdomain depth (${labels.length} labels) — suspicious`);
  }

  // Dash-heavy domains
  if ((d.match(/-/g) || []).length > 3) {
    patterns.push("Multiple dashes in domain — common phishing pattern");
  }

  // Number-heavy domains
  const digits = (d.match(/\d/g) || []).length;
  if (digits > 5) {
    patterns.push("Many digits in domain name — possible DGA or disposable domain");
  }

  return patterns;
}

// ── Full Threat Assessment ──────────────────────────────

export async function fullThreatCheck(target: string): Promise<ThreatResult> {
  const domain = target.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];

  // Resolve IP for DNSBL checks
  let ip: string | undefined;
  const { stdout } = await execFileNoThrow("dig", ["+short", domain, "A"], { timeoutMs: 5000 });
  ip = stdout.split("\n")[0]?.trim() || undefined;

  // Run all checks in parallel
  const [urlhausThreats, sslIssues, blacklists, suspiciousPatterns] = await Promise.all([
    checkUrlhaus(domain),
    checkSslSecurity(domain),
    ip ? checkDnsBlacklists(ip) : Promise.resolve([]),
    Promise.resolve(detectSuspiciousPatterns(domain)),
  ]);

  // Check PhishTank if URL-like
  let phishThreats: ThreatEntry[] = [];
  if (target.startsWith("http")) {
    phishThreats = await checkPhishTank(target);
  }

  const allThreats = [...urlhausThreats, ...phishThreats];
  const blacklistHits = blacklists.filter(b => b.listed).length;

  // Calculate risk score
  let riskScore = 0;
  riskScore += allThreats.length * 20;
  riskScore += blacklistHits * 15;
  riskScore += sslIssues.length * 10;
  riskScore += suspiciousPatterns.length * 8;
  riskScore = Math.min(100, riskScore);

  return {
    target,
    malicious: riskScore >= 50 || allThreats.some(t => t.confidence > 0.8),
    threats: allThreats,
    blacklists,
    sslIssues,
    suspiciousPatterns,
    riskScore,
    timestamp: new Date().toISOString(),
  };
}
