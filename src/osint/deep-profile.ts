/**
 * Deep Profile — historical depth, person profiling, intelligent next-step generation
 * Combines multiple modules into deep longitudinal analysis
 */

// ── 1. Historical Depth Analysis (5-year tracking) ──────

export interface HistoricalProfile {
  target: string;
  whoisHistory: WhoisSnapshot[];
  dnsTimeline: { date: string; type: string; value: string; change: "added" | "removed" | "stable" }[];
  certHistory: { date: string; issuer: string; cn: string; event: "issued" | "expired" }[];
  waybackTimeline: { date: string; title?: string; size?: number }[];
  contentChanges: number;
  ageIndicators: string[];
  timestamp: string;
}

export interface WhoisSnapshot {
  date: string;
  registrar?: string;
  nameservers: string[];
  status: string[];
}

export async function buildHistoricalProfile(domain: string): Promise<HistoricalProfile> {
  const clean = domain.replace(/[^a-zA-Z0-9.\-]/g, "");
  const result: HistoricalProfile = {
    target: clean, whoisHistory: [], dnsTimeline: [], certHistory: [],
    waybackTimeline: [], contentChanges: 0, ageIndicators: [], timestamp: new Date().toISOString(),
  };

  // Current WHOIS as first snapshot
  try {
    const { whoisLookup } = await import("./domain-recon.js");
    const whois = await whoisLookup(clean);
    result.whoisHistory.push({
      date: new Date().toISOString(),
      registrar: whois.registrar,
      nameservers: whois.nameServers,
      status: whois.status,
    });

    // Age indicators
    if (whois.createdDate) {
      const created = new Date(whois.createdDate);
      const ageYears = (Date.now() - created.getTime()) / (365.25 * 86400000);
      result.ageIndicators.push(`Domain registered: ${whois.createdDate} (${ageYears.toFixed(1)} years)`);
      if (ageYears < 0.5) result.ageIndicators.push("⚠ Very new domain (< 6 months)");
      if (ageYears > 10) result.ageIndicators.push("✓ Well-established domain (10+ years)");
    }
    if (whois.expiryDate) {
      const expiry = new Date(whois.expiryDate);
      const daysLeft = (expiry.getTime() - Date.now()) / 86400000;
      if (daysLeft < 30) result.ageIndicators.push(`⚠ Domain expires in ${Math.round(daysLeft)} days`);
      if (daysLeft > 365 * 3) result.ageIndicators.push("✓ Domain registered for 3+ years ahead");
    }
  } catch {}

  // Certificate history from CT logs
  try {
    const { certTransparency } = await import("./domain-recon.js");
    const certs = await certTransparency(clean);
    for (const cert of certs.slice(0, 30)) {
      if (cert.notBefore) result.certHistory.push({ date: cert.notBefore, issuer: cert.issuer, cn: cert.commonName, event: "issued" });
      if (cert.notAfter) result.certHistory.push({ date: cert.notAfter, issuer: cert.issuer, cn: cert.commonName, event: "expired" });
    }
    result.certHistory.sort((a, b) => a.date.localeCompare(b.date));
  } catch {}

  // Wayback Machine timeline
  try {
    const response = await fetch(
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(clean)}&output=json&limit=100&fl=timestamp,statuscode&filter=statuscode:200`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (response.ok) {
      const data: string[][] = await response.json();
      for (const row of data.slice(1)) {
        const ts = row[0];
        result.waybackTimeline.push({
          date: `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)}`,
        });
      }
      result.contentChanges = result.waybackTimeline.length;
      if (result.waybackTimeline.length > 0) {
        result.ageIndicators.push(`Wayback: ${result.waybackTimeline.length} snapshots, first: ${result.waybackTimeline[0].date}`);
      }
    }
  } catch {}

  return result;
}

// ── 2. Person Profile Builder ───────────────────────────

export interface PersonProfile {
  name: string;
  usernames: { platform: string; url: string; verified: boolean }[];
  emails: string[];
  domains: string[];
  organizations: string[];
  locations: string[];
  technologies: string[];
  publications: { title: string; year?: number; venue?: string }[];
  socialPresence: { platform: string; exists: boolean }[];
  digitalFootprint: number; // 0-100
  summary: string;
  timestamp: string;
}

export async function buildPersonProfile(query: string): Promise<PersonProfile> {
  const profile: PersonProfile = {
    name: query, usernames: [], emails: [], domains: [], organizations: [],
    locations: [], technologies: [], publications: [], socialPresence: [],
    digitalFootprint: 0, summary: "", timestamp: new Date().toISOString(),
  };

  const isEmail = query.includes("@");
  const username = isEmail ? query.split("@")[0] : query;

  // Username enumeration across platforms
  try {
    const { enumerateUsername } = await import("./identity-recon.js");
    const results = await enumerateUsername(username, { concurrency: 5 });
    profile.socialPresence = results.map(r => ({ platform: r.platform, exists: r.exists }));
    profile.usernames = results.filter(r => r.exists).map(r => ({ platform: r.platform, url: r.url, verified: true }));
  } catch {}

  // Email validation
  if (isEmail) {
    try {
      const { validateEmail } = await import("./identity-recon.js");
      const validation = await validateEmail(query);
      profile.emails.push(query);
      if (validation.domain) profile.domains.push(validation.domain);
    } catch {}
  }

  // Academic profile
  try {
    const { lookupAuthor } = await import("./public-records.js");
    const author = await lookupAuthor(query);
    if (author) {
      profile.organizations.push(...author.affiliations);
      profile.publications = []; // Would need another call for actual papers
      if (author.hIndex) profile.summary += `Academic: h-index ${author.hIndex}, ${author.citationCount} citations. `;
    }
  } catch {}

  // Calculate digital footprint score
  const found = profile.usernames.length;
  const total = profile.socialPresence.length;
  profile.digitalFootprint = total > 0 ? Math.round((found / total) * 100) : 0;

  profile.summary += `Digital footprint: ${found}/${total} platforms (${profile.digitalFootprint}%). `;
  if (profile.emails.length > 0) profile.summary += `Email(s): ${profile.emails.join(", ")}. `;
  if (profile.organizations.length > 0) profile.summary += `Org(s): ${profile.organizations.join(", ")}. `;

  return profile;
}

// ── 3. Intelligent Next-Step Discovery Generator ────────

export interface NextStep {
  action: string;
  target: string;
  module: string;
  priority: "high" | "medium" | "low";
  reasoning: string;
  automated: boolean; // Can be executed automatically?
}

export function generateNextSteps(findings: Record<string, any>): NextStep[] {
  const steps: NextStep[] = [];

  // From domain findings
  if (findings.domain) {
    const d = findings.domain;

    // Zone transfer success → critical follow-up
    if (d.zoneTransfer?.success) {
      steps.push({ action: "Analyze leaked zone records for internal hostnames", target: d.domain, module: "manual_analysis", priority: "high", reasoning: "Zone transfer reveals internal infrastructure", automated: false });
    }

    // Many subdomains → check takeover
    if ((d.subdomains?.length || 0) > 20) {
      steps.push({ action: "Check subdomains for takeover vulnerabilities", target: d.domain, module: "subdomain-takeover", priority: "high", reasoning: `${d.subdomains.length} subdomains — high chance of dangling CNAMEs`, automated: true });
    }

    // WHOIS not private → dig deeper into registrant
    if (d.whois?.registrantOrg) {
      steps.push({ action: `Investigate registrant organization: ${d.whois.registrantOrg}`, target: d.whois.registrantOrg, module: "company-intel", priority: "medium", reasoning: "WHOIS reveals organization — can find more domains owned by same entity", automated: true });
    }

    // Multiple nameservers → check for NS diversity
    if (d.whois?.nameServers?.length === 1) {
      steps.push({ action: "Single nameserver — check for DNS availability risk", target: d.domain, module: "dns-audit", priority: "medium", reasoning: "Only one nameserver creates single point of failure", automated: false });
    }
  }

  // From network findings
  if (findings.network) {
    const n = findings.network;
    const openPorts = (n.openPorts || []).filter((p: any) => p.state === "open");

    // Database ports open → critical
    const dbPorts = openPorts.filter((p: any) => [3306, 5432, 6379, 27017, 11211].includes(p.port));
    if (dbPorts.length > 0) {
      steps.push({ action: `Investigate open database ports: ${dbPorts.map((p: any) => `${p.port}/${p.service}`).join(", ")}`, target: n.target, module: "port-deep-scan", priority: "high", reasoning: "Exposed database ports — potential data breach vector", automated: false });
    }

    // Missing security headers → check more
    if (n.httpHeaders?.securityHeaders) {
      const missing = Object.entries(n.httpHeaders.securityHeaders).filter(([, v]) => !v).map(([k]) => k);
      if (missing.length > 3) {
        steps.push({ action: `Fix missing security headers: ${missing.join(", ")}`, target: n.target, module: "security-audit", priority: "medium", reasoning: `${missing.length} security headers missing — increased attack surface`, automated: false });
      }
    }
  }

  // From identity findings
  if (findings.identity) {
    const id = findings.identity;
    if ((id.foundProfiles?.length || 0) > 5) {
      steps.push({ action: "Build deep person profile with cross-platform correlation", target: id.query, module: "deep-profile", priority: "medium", reasoning: `Found on ${id.foundProfiles.length} platforms — can build comprehensive profile`, automated: true });
    }

    if (id.emailValidation?.disposable) {
      steps.push({ action: "Flag as potential throwaway identity", target: id.query, module: "threat-assessment", priority: "high", reasoning: "Disposable email — common for fraud/spam", automated: false });
    }
  }

  // From threat findings
  if (findings.threat) {
    if (findings.threat.malicious || findings.threat.riskScore > 50) {
      steps.push({ action: "Deep malware analysis — check related infrastructure", target: findings.threat.target, module: "pivot-engine", priority: "high", reasoning: `Risk score ${findings.threat.riskScore}/100 — investigate associated domains/IPs`, automated: true });
    }
  }

  // From web findings
  if (findings.web) {
    if (findings.web.techStack?.cms === "WordPress") {
      steps.push({ action: "WordPress vulnerability scan (wp-scan equivalent)", target: findings.web.target, module: "cms-audit", priority: "medium", reasoning: "WordPress detected — check for known plugin/theme vulnerabilities", automated: true });
    }
    if ((findings.web.robots?.disallowed?.length || 0) > 10) {
      steps.push({ action: "Investigate disallowed paths in robots.txt", target: findings.web.target, module: "dir-bruteforce", priority: "medium", reasoning: `${findings.web.robots.disallowed.length} paths hidden from search engines`, automated: true });
    }
  }

  // Generic
  if (!findings.threat) {
    steps.push({ action: "Run threat intelligence check", target: Object.values(findings)[0]?.target || Object.values(findings)[0]?.domain || "unknown", module: "threat-intel", priority: "low", reasoning: "No threat check performed yet", automated: true });
  }

  return steps.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });
}
