/**
 * URL Safety Check — multi-engine malicious URL detection without API keys
 * Google Safe Browsing (via Transparency Report), URLhaus, PhishTank, abuse.ch
 */

export interface UrlSafetyResult {
  url: string;
  safe: boolean;
  engines: EngineResult[];
  riskScore: number;  // 0-100
  categories: string[];
  timestamp: string;
}

export interface EngineResult {
  engine: string;
  safe: boolean;
  detail?: string;
  source: string;
}

// ── Google Safe Browsing (Transparency Report — free) ───

async function checkGoogleSafeBrowsing(url: string): Promise<EngineResult> {
  try {
    // Google Transparency Report API (undocumented but free)
    const encoded = encodeURIComponent(url);
    const response = await fetch(
      `https://transparencyreport.google.com/transparencyreport/api/v3/safebrowsing/status?site=${encoded}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0" },
      }
    );
    if (response.ok) {
      const text = await response.text();
      // Response starts with ")]}'" prefix
      const clean = text.replace(/^\)\]\}'\n?/, "");
      try {
        const data = JSON.parse(clean);
        // data[0] or data[1] contains safety status
        const isSafe = !text.includes("SITE_MALICIOUS") && !text.includes("SOCIAL_ENGINEERING");
        return {
          engine: "Google Safe Browsing",
          safe: isSafe,
          detail: isSafe ? "No threats detected" : "Flagged as unsafe",
          source: "transparencyreport.google.com",
        };
      } catch {}
    }
  } catch {}

  return { engine: "Google Safe Browsing", safe: true, detail: "Unable to check", source: "transparencyreport.google.com" };
}

// ── URLhaus (abuse.ch — free) ───────────────────────────

async function checkUrlhaus(url: string): Promise<EngineResult> {
  try {
    const response = await fetch("https://urlhaus-api.abuse.ch/v1/url/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `url=${encodeURIComponent(url)}`,
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      const data = await response.json();
      if (data.query_status === "ok" && data.id) {
        return {
          engine: "URLhaus",
          safe: false,
          detail: `Threat: ${data.threat || "unknown"} | Tags: ${(data.tags || []).join(", ")}`,
          source: "urlhaus-api.abuse.ch",
        };
      }
    }
  } catch {}

  return { engine: "URLhaus", safe: true, detail: "Not in database", source: "urlhaus-api.abuse.ch" };
}

// ── PhishTank (free) ────────────────────────────────────

async function checkPhishTank(url: string): Promise<EngineResult> {
  try {
    const response = await fetch("https://checkurl.phishtank.com/checkurl/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `url=${encodeURIComponent(url)}&format=json`,
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      const data = await response.json();
      if (data.results?.in_database) {
        return {
          engine: "PhishTank",
          safe: false,
          detail: `Phishing: ${data.results.verified ? "verified" : "unverified"}`,
          source: "phishtank.com",
        };
      }
    }
  } catch {}

  return { engine: "PhishTank", safe: true, detail: "Not in database", source: "phishtank.com" };
}

// ── VirusTotal Public Lookup (web scrape — no API key) ──

async function checkVirusTotalPublic(url: string): Promise<EngineResult> {
  try {
    // VT has a public URL check via their web interface
    const hash = await urlToSha256(url);
    const response = await fetch(
      `https://www.virustotal.com/ui/urls/${hash}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      }
    );
    if (response.ok) {
      const data = await response.json();
      const stats = data.data?.attributes?.last_analysis_stats;
      if (stats) {
        const malicious = stats.malicious || 0;
        const suspicious = stats.suspicious || 0;
        const total = malicious + suspicious + (stats.harmless || 0) + (stats.undetected || 0);
        return {
          engine: "VirusTotal",
          safe: malicious === 0 && suspicious === 0,
          detail: `${malicious}/${total} engines flagged as malicious`,
          source: "virustotal.com",
        };
      }
    }
  } catch {}

  return { engine: "VirusTotal", safe: true, detail: "Unable to check (rate limited)", source: "virustotal.com" };
}

async function urlToSha256(url: string): Promise<string> {
  const crypto = await import("crypto");
  // VT uses base64url of the URL as identifier
  return Buffer.from(url).toString("base64url").replace(/=+$/, "");
}

// ── AbuseIPDB (free 100 checks/day) ────────────────────

async function checkAbuseIpdb(ip: string): Promise<EngineResult> {
  try {
    const response = await fetch(
      `https://www.abuseipdb.com/check/${ip}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      }
    );
    if (response.ok) {
      const html = await response.text();
      const scoreMatch = html.match(/Confidence of Abuse[^>]*>(\d+)%/);
      if (scoreMatch) {
        const score = parseInt(scoreMatch[1]);
        return {
          engine: "AbuseIPDB",
          safe: score < 25,
          detail: `Abuse confidence: ${score}%`,
          source: "abuseipdb.com",
        };
      }
    }
  } catch {}

  return { engine: "AbuseIPDB", safe: true, detail: "Unable to check", source: "abuseipdb.com" };
}

// ── Combined Multi-Engine Check ─────────────────────────

export async function checkUrlSafety(url: string): Promise<UrlSafetyResult> {
  const targetUrl = url.startsWith("http") ? url : `https://${url}`;
  const domain = new URL(targetUrl).hostname;

  // Run all engines in parallel
  const [google, urlhaus, phishtank, vt] = await Promise.all([
    checkGoogleSafeBrowsing(targetUrl),
    checkUrlhaus(targetUrl),
    checkPhishTank(targetUrl),
    checkVirusTotalPublic(targetUrl),
  ]);

  const engines = [google, urlhaus, phishtank, vt];
  const unsafe = engines.filter(e => !e.safe);
  const categories: string[] = [];

  if (unsafe.some(e => e.engine === "PhishTank")) categories.push("phishing");
  if (unsafe.some(e => e.engine === "URLhaus")) categories.push("malware");
  if (unsafe.some(e => e.detail?.includes("malicious"))) categories.push("malicious");

  const riskScore = Math.min(100, unsafe.length * 25);

  return {
    url: targetUrl,
    safe: unsafe.length === 0,
    engines,
    riskScore,
    categories,
    timestamp: new Date().toISOString(),
  };
}

// ── IP Reputation (multi-source) ────────────────────────

export async function checkIpReputation(ip: string): Promise<UrlSafetyResult> {
  const clean = ip.replace(/[^0-9.]/g, "");

  const [abuseip, urlhaus] = await Promise.all([
    checkAbuseIpdb(clean),
    checkUrlhaus(`http://${clean}`),
  ]);

  // Also check DNSBL
  const { checkDnsBlacklists } = await import("./threat-intel.js");
  const blacklists = await checkDnsBlacklists(clean);
  const listedCount = blacklists.filter(b => b.listed).length;

  const engines = [abuseip, urlhaus];
  if (listedCount > 0) {
    engines.push({
      engine: "DNSBL",
      safe: false,
      detail: `Listed on ${listedCount}/${blacklists.length} blacklists`,
      source: "dnsbl",
    });
  }

  const unsafe = engines.filter(e => !e.safe);
  const riskScore = Math.min(100, unsafe.length * 20 + listedCount * 10);

  return {
    url: clean,
    safe: unsafe.length === 0,
    engines,
    riskScore,
    categories: listedCount > 0 ? ["blacklisted"] : [],
    timestamp: new Date().toISOString(),
  };
}
