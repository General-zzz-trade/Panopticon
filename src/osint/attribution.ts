/**
 * Attribution Engine — multi-source fragment correlation to identify entities behind targets
 * Combines WHOIS, certificates, social profiles, code commits, DNS patterns to infer ownership
 */

export interface AttributionResult {
  target: string;
  attributions: Attribution[];
  evidence: EvidenceChain[];
  confidence: number;  // 0-1
  summary: string;
  timestamp: string;
}

export interface Attribution {
  entityType: "person" | "organization" | "email" | "username";
  entityValue: string;
  confidence: number;
  sources: string[];
  reasoning: string;
}

export interface EvidenceChain {
  step: number;
  source: string;
  finding: string;
  leadsTo: string;
  confidence: number;
}

// ── Evidence Collectors ─────────────────────────────────

interface RawEvidence {
  source: string;
  type: string;
  value: string;
  confidence: number;
}

async function collectWhoisEvidence(domain: string): Promise<RawEvidence[]> {
  const evidence: RawEvidence[] = [];
  try {
    const { whoisLookup } = await import("./domain-recon.js");
    const whois = await whoisLookup(domain);

    if (whois.registrant) evidence.push({ source: "whois", type: "person", value: whois.registrant, confidence: 0.7 });
    if (whois.registrantOrg) evidence.push({ source: "whois", type: "organization", value: whois.registrantOrg, confidence: 0.8 });
    if (whois.registrantCountry) evidence.push({ source: "whois", type: "country", value: whois.registrantCountry, confidence: 0.9 });

    // Check if privacy-protected
    const { detectWhoisPrivacy } = await import("./advanced-recon.js");
    const privacy = detectWhoisPrivacy(whois.raw);
    if (privacy.privacyEnabled) {
      // Reduce confidence of WHOIS evidence when privacy is on
      evidence.forEach(e => e.confidence *= 0.3);
      evidence.push({ source: "whois", type: "indicator", value: "WHOIS privacy enabled", confidence: 0.9 });
    }
  } catch {}
  return evidence;
}

async function collectCertEvidence(domain: string): Promise<RawEvidence[]> {
  const evidence: RawEvidence[] = [];
  try {
    const { sslDeepAnalysis } = await import("./advanced-recon.js");
    const ssl = await sslDeepAnalysis(domain);

    if (ssl.certSubject) {
      // Extract organization from cert subject: O = Company Name
      const orgMatch = ssl.certSubject.match(/O\s*=\s*([^,/]+)/);
      if (orgMatch) evidence.push({ source: "certificate", type: "organization", value: orgMatch[1].trim(), confidence: 0.85 });

      // Extract common name
      const cnMatch = ssl.certSubject.match(/CN\s*=\s*([^,/]+)/);
      if (cnMatch) evidence.push({ source: "certificate", type: "domain", value: cnMatch[1].trim(), confidence: 0.9 });
    }

    // SANs reveal related domains
    for (const san of ssl.sanNames || []) {
      if (san !== domain && san.includes(".")) {
        evidence.push({ source: "certificate-san", type: "domain", value: san, confidence: 0.8 });
      }
    }
  } catch {}
  return evidence;
}

async function collectDnsEvidence(domain: string): Promise<RawEvidence[]> {
  const evidence: RawEvidence[] = [];
  try {
    const { dnsLookup } = await import("./domain-recon.js");
    const records = await dnsLookup(domain, ["TXT", "MX", "NS"]);

    for (const r of records) {
      if (r.type === "TXT") {
        // SPF includes reveal partner organizations
        const includes = r.value.match(/include:(\S+)/g) || [];
        for (const inc of includes) {
          const incDomain = inc.replace("include:", "");
          evidence.push({ source: "spf-include", type: "domain", value: incDomain, confidence: 0.6 });
        }

        // Google Workspace verification
        if (r.value.includes("google-site-verification")) {
          evidence.push({ source: "dns-txt", type: "indicator", value: "Google Workspace user", confidence: 0.7 });
        }
        if (r.value.includes("MS=")) {
          evidence.push({ source: "dns-txt", type: "indicator", value: "Microsoft 365 user", confidence: 0.7 });
        }
      }

      if (r.type === "MX") {
        // Mail provider reveals organization type
        const mx = r.value.toLowerCase();
        if (mx.includes("google")) evidence.push({ source: "mx", type: "indicator", value: "Uses Google Workspace", confidence: 0.7 });
        if (mx.includes("outlook") || mx.includes("microsoft")) evidence.push({ source: "mx", type: "indicator", value: "Uses Microsoft 365", confidence: 0.7 });
        if (mx.includes("protonmail")) evidence.push({ source: "mx", type: "indicator", value: "Uses ProtonMail (privacy-conscious)", confidence: 0.7 });
      }
    }
  } catch {}
  return evidence;
}

async function collectSmtpEvidence(domain: string): Promise<RawEvidence[]> {
  const evidence: RawEvidence[] = [];
  try {
    const { collectSmtpBanner } = await import("./protocol-analysis.js");

    // Get MX first
    const { execFileNoThrow } = await import("../utils/execFileNoThrow.js");
    const { stdout } = await execFileNoThrow("dig", ["+short", domain, "MX"], { timeoutMs: 5000 });
    const mxHost = stdout.trim().split("\n")[0]?.split(/\s+/).pop()?.replace(/\.$/, "");

    if (mxHost) {
      const smtp = await collectSmtpBanner(mxHost);
      if (smtp.hostname && smtp.hostname !== mxHost) {
        // Internal hostname leaked!
        evidence.push({ source: "smtp-banner", type: "hostname", value: smtp.hostname, confidence: 0.8 });
      }
      if (smtp.software) {
        evidence.push({ source: "smtp-banner", type: "technology", value: smtp.software, confidence: 0.7 });
      }
    }
  } catch {}
  return evidence;
}

async function collectCompanyEvidence(domain: string): Promise<RawEvidence[]> {
  const evidence: RawEvidence[] = [];
  try {
    // Wikipedia/DuckDuckGo for company name
    const { searchWikipedia, searchDdgCompany } = await import("./company-intel.js");
    const baseName = domain.split(".")[0];

    const [wiki, ddg] = await Promise.all([
      searchWikipedia(baseName),
      searchDdgCompany(baseName),
    ]);

    // DuckDuckGo instant answer (high confidence if exists)
    if (ddg && ddg.name) {
      evidence.push({ source: "duckduckgo", type: "organization", value: ddg.name, confidence: 0.75 });
      if (ddg.industry) {
        evidence.push({ source: "duckduckgo", type: "indicator", value: `Industry: ${ddg.industry.slice(0, 100)}`, confidence: 0.6 });
      }
    }

    // Wikipedia results
    for (const w of wiki.slice(0, 2)) {
      evidence.push({ source: "wikipedia", type: "organization", value: w.name, confidence: 0.7 });
    }
  } catch {}
  return evidence;
}

// ── Attribution Logic ───────────────────────────────────

function buildAttributions(evidence: RawEvidence[]): Attribution[] {
  const attributionMap = new Map<string, { confidence: number; sources: Set<string>; reasoning: string[] }>();

  for (const e of evidence) {
    if (e.type === "person" || e.type === "organization" || e.type === "email" || e.type === "username") {
      const key = `${e.type}:${e.value.toLowerCase()}`;
      const existing = attributionMap.get(key) || { confidence: 0, sources: new Set(), reasoning: [] };

      // Multiple sources increase confidence
      existing.confidence = Math.min(0.99, existing.confidence + e.confidence * 0.5);
      existing.sources.add(e.source);
      existing.reasoning.push(`${e.source}: ${e.value}`);
      attributionMap.set(key, existing);
    }
  }

  return Array.from(attributionMap.entries()).map(([key, data]) => {
    const [type, value] = key.split(":", 2);
    return {
      entityType: type as any,
      entityValue: value,
      confidence: Math.round(data.confidence * 100) / 100,
      sources: [...data.sources],
      reasoning: `Found via ${data.sources.size} source(s): ${[...data.sources].join(", ")}`,
    };
  }).sort((a, b) => b.confidence - a.confidence);
}

function buildEvidenceChain(evidence: RawEvidence[]): EvidenceChain[] {
  return evidence.map((e, i) => ({
    step: i + 1,
    source: e.source,
    finding: `${e.type}: ${e.value}`,
    leadsTo: e.type === "domain" ? "Further domain analysis" :
             e.type === "person" || e.type === "organization" ? "Entity identification" :
             e.type === "indicator" ? "Behavioral pattern" : "Additional context",
    confidence: e.confidence,
  }));
}

// ── Main Attribution Engine ─────────────────────────────

export async function attributeTarget(domain: string): Promise<AttributionResult> {
  const clean = domain.replace(/[^a-zA-Z0-9.\-]/g, "");

  // Collect evidence from all sources in parallel
  const [whoisEv, certEv, dnsEv, smtpEv, companyEv] = await Promise.all([
    collectWhoisEvidence(clean),
    collectCertEvidence(clean),
    collectDnsEvidence(clean),
    collectSmtpEvidence(clean),
    collectCompanyEvidence(clean),
  ]);

  const allEvidence = [...whoisEv, ...certEv, ...dnsEv, ...smtpEv, ...companyEv];
  const attributions = buildAttributions(allEvidence);
  const evidenceChain = buildEvidenceChain(allEvidence);

  const topAttribution = attributions[0];
  const confidence = topAttribution?.confidence || 0;

  let summary: string;
  if (confidence > 0.7) {
    summary = `High confidence: ${clean} is likely owned/operated by ${topAttribution.entityValue} (${topAttribution.entityType})`;
  } else if (confidence > 0.4) {
    summary = `Medium confidence: ${clean} may be associated with ${topAttribution?.entityValue || "unknown entity"}`;
  } else {
    summary = `Low confidence: insufficient evidence to attribute ${clean} to a specific entity`;
  }

  return {
    target: clean,
    attributions,
    evidence: evidenceChain,
    confidence,
    summary,
    timestamp: new Date().toISOString(),
  };
}
