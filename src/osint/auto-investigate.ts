/**
 * Autonomous Investigation Pipeline — end-to-end automated OSINT
 * Target → Plan → Collect → Analyze → Correlate → Score → Report → Notify
 */

export interface AutoInvestigationResult {
  target: string;
  plan: { phases: { name: string; modules: string[] }[] };
  findings: Record<string, any>;
  multiDimensionScore: MultiDimensionScore;
  correlations: { crossLinks: any[]; keyInsights: string[] };
  nextSteps: { action: string; priority: string; reasoning: string }[];
  report: string;
  stixBundle?: any;
  stats: {
    modulesRun: number;
    modulesSucceeded: number;
    entitiesFound: number;
    durationMs: number;
  };
  timestamp: string;
}

export interface MultiDimensionScore {
  overall: number;       // 0-100
  threat: number;        // Malicious indicators
  exposure: number;      // Attack surface size
  vulnerability: number; // Known weaknesses
  reputation: number;    // Blacklists, breach history
  maturity: number;      // Security posture (headers, SSL, DMARC)
  verdict: "critical" | "high" | "medium" | "low" | "minimal";
  breakdown: string[];
}

// ── Multi-Dimensional Risk Scoring ──────────────────────

function calculateMultiDimensionScore(findings: Record<string, any>): MultiDimensionScore {
  let threat = 0, exposure = 0, vulnerability = 0, reputation = 0, maturity = 100;
  const breakdown: string[] = [];

  // Normalize field names: auto-investigate uses module_name, scoring expects short names
  const f = {
    domain: findings.domain || findings.domain_recon,
    network: findings.network || findings.network_recon || findings.nmap_scan,
    threat: findings.threat || findings.threat_intel,
    web: findings.web || findings.web_intel,
    breach: findings.breach || findings.breach_check,
    ssl: findings.ssl || findings.ssl_analysis,
    cve: findings.cve || findings.cve_matcher,
    protocol: findings.protocol || findings.email_security,
    url_safety: findings.url_safety,
    dir_scan: findings.dir_scan,
    waf: findings.waf || findings.waf_detect,
    temporal: findings.temporal,
  };

  // Threat dimension
  if (f.threat) {
    threat += f.threat.threats?.length * 15 || 0;
    threat += (f.threat.blacklists?.filter((b: any) => b.listed).length || 0) * 10;
    threat += f.threat.suspiciousPatterns?.length * 5 || 0;
    if (f.threat.malicious) { threat += 30; breakdown.push("⚠ Flagged as malicious by threat feeds"); }
    if (f.threat.riskScore > 50) { threat += 20; breakdown.push(`Threat risk score: ${f.threat.riskScore}/100`); }
  }

  // URL safety
  if (f.url_safety && !f.url_safety.safe) {
    threat += 25;
    breakdown.push(`URL flagged unsafe by ${f.url_safety.engines?.filter((e: any) => !e.safe).length} engines`);
  }

  // Exposure dimension
  if (f.domain) {
    const subCount = f.domain.subdomains?.length || 0;
    if (subCount > 50) { exposure += 20; breakdown.push(`Large attack surface: ${subCount} subdomains`); }
    else if (subCount > 20) { exposure += 10; }
    if (f.domain.zoneTransfer?.success) { exposure += 30; breakdown.push("DNS zone transfer enabled (critical)"); }
  }

  if (f.network) {
    // Handle both nmap format (ports[].state) and network_recon format (openPorts[].state)
    const allPorts = f.network.ports || f.network.openPorts || [];
    const openPorts = allPorts.filter((p: any) => p.state === "open");
    const riskyPorts = openPorts.filter((p: any) => [21, 23, 135, 139, 445, 3306, 5432, 6379, 27017].includes(p.port));
    exposure += riskyPorts.length * 10;
    if (riskyPorts.length > 0) breakdown.push(`Risky open ports: ${riskyPorts.map((p: any) => `${p.port}/${p.service}`).join(", ")}`);

    if (f.network.httpHeaders?.securityHeaders) {
      const sec = f.network.httpHeaders.securityHeaders;
      const missing = Object.entries(sec).filter(([, v]) => !v).length;
      maturity -= missing * 8;
      if (missing > 3) breakdown.push(`Missing ${missing} security headers`);
    }
  }

  // Dir scan findings
  if (f.dir_scan) {
    const critical = f.dir_scan.found?.filter((d: any) => d.severity === "critical").length || 0;
    const high = f.dir_scan.found?.filter((d: any) => d.severity === "high").length || 0;
    if (critical > 0) { vulnerability += critical * 20; breakdown.push(`${critical} critical paths exposed (.env, .git, etc.)`); }
    if (high > 0) { vulnerability += high * 10; breakdown.push(`${high} high-risk paths found`); }
  }

  // Vulnerability dimension
  if (f.cve) {
    const critical = f.cve.matches?.filter((m: any) => m.severity === "CRITICAL").length || 0;
    const high = f.cve.matches?.filter((m: any) => m.severity === "HIGH").length || 0;
    vulnerability += critical * 25 + high * 15;
    if (critical > 0) breakdown.push(`${critical} CRITICAL CVEs`);
  }

  if (f.web?.techStack?.cms === "WordPress") {
    vulnerability += 10;
    breakdown.push("WordPress CMS (common target)");
  }

  // Reputation dimension
  if (f.breach?.breached) {
    reputation += 20;
    breakdown.push("Appears in breach databases");
  }

  // Email security → maturity
  if (f.protocol) {
    if (f.protocol.securityScore !== undefined) {
      if (f.protocol.securityScore >= 80) maturity += 10;
      else if (f.protocol.securityScore < 40) {
        maturity -= 20;
        breakdown.push(`Weak email security: ${f.protocol.securityScore}/100`);
      }
      if (!f.protocol.spf?.exists) { maturity -= 10; }
      if (!f.protocol.dmarc?.exists) { maturity -= 10; breakdown.push("No DMARC policy"); }
    }
  }

  // SSL/TLS
  if (f.ssl) {
    if (f.ssl.issues?.length > 0) {
      maturity -= f.ssl.issues.length * 5;
      breakdown.push(`SSL issues: ${f.ssl.issues.length}`);
    }
    if (f.ssl.protocol?.includes("TLSv1.3")) maturity += 5;
  }

  // Temporal anomalies
  if (f.temporal?.anomalies?.length > 0) {
    const criticalAnomalies = f.temporal.anomalies.filter((a: any) => a.severity === "critical" || a.severity === "high");
    if (criticalAnomalies.length > 0) {
      threat += criticalAnomalies.length * 10;
      breakdown.push(`${criticalAnomalies.length} temporal anomalies detected`);
    }
  }

  // Domain age (from temporal)
  if (f.temporal?.domainAge?.isNew) {
    threat += 20;
    breakdown.push(`New domain: ${f.temporal.domainAge.ageInDays} days old`);
  }

  // No WAF detected on a public website
  if (f.waf && f.waf.waf?.length === 0 && f.domain) {
    maturity -= 5;
  }

  // Normalize
  threat = Math.min(100, Math.max(0, threat));
  exposure = Math.min(100, Math.max(0, exposure));
  vulnerability = Math.min(100, Math.max(0, vulnerability));
  reputation = Math.min(100, Math.max(0, reputation));
  maturity = Math.min(100, Math.max(0, maturity));

  // Overall = weighted average (higher = worse, except maturity)
  const overall = Math.round(
    threat * 0.3 + exposure * 0.2 + vulnerability * 0.25 + reputation * 0.1 + (100 - maturity) * 0.15
  );

  let verdict: MultiDimensionScore["verdict"];
  if (overall >= 70) verdict = "critical";
  else if (overall >= 50) verdict = "high";
  else if (overall >= 30) verdict = "medium";
  else if (overall >= 15) verdict = "low";
  else verdict = "minimal";

  return { overall, threat, exposure, vulnerability, reputation, maturity, verdict, breakdown };
}

// ── Full Auto Investigation Pipeline ────────────────────

export async function autoInvestigate(
  target: string,
  options: { depth?: "quick" | "standard" | "deep"; modules?: string[] } = {}
): Promise<AutoInvestigationResult> {
  const start = Date.now();
  const depth = options.depth || "standard";
  const findings: Record<string, any> = {};
  let modulesRun = 0, modulesSucceeded = 0;

  // Phase 1: Planning
  const { llmPlanInvestigation } = await import("./llm-analyst.js");
  const plan = await llmPlanInvestigation(target);

  // Phase 2: Execution (run modules per plan phases)
  for (const phase of plan.phases) {
    for (const mod of phase.modules) {
      modulesRun++;
      try {
        const result = await executeModule(mod, target);
        if (result) { findings[mod] = result; modulesSucceeded++; }
      } catch {}

      // Quick mode: stop after phase 1
      if (depth === "quick" && modulesRun >= 3) break;
    }
    if (depth === "quick" && modulesRun >= 3) break;
  }

  // Phase 3: Multi-dimensional scoring
  const multiDimensionScore = calculateMultiDimensionScore(findings);

  // Phase 4: Cross-module correlation
  let correlations = { crossLinks: [] as any[], keyInsights: [] as string[] };
  try {
    const { correlateFindings } = await import("./deep-extract.js");
    correlations = correlateFindings(findings);
  } catch {}

  // Phase 5: Next steps (normalize field names for compatibility)
  let nextSteps: any[] = [];
  try {
    const { generateNextSteps } = await import("./deep-profile.js");
    const normalized: Record<string, any> = { ...findings };
    if (findings.domain_recon) normalized.domain = findings.domain_recon;
    if (findings.nmap_scan) normalized.network = { ...findings.nmap_scan, openPorts: findings.nmap_scan?.ports };
    if (findings.threat_intel) normalized.threat = findings.threat_intel;
    if (findings.web_intel) normalized.web = findings.web_intel;
    if (findings.email_security) normalized.protocol = findings.email_security;
    nextSteps = generateNextSteps(normalized);
  } catch {}

  // Phase 6: Report
  let report = "";
  try {
    const { llmGenerateReport } = await import("./llm-analyst.js");
    report = await llmGenerateReport(findings, target);
  } catch {}

  // Phase 7: STIX export
  let stixBundle;
  try {
    const { investigationToStix } = await import("./stix-export.js");
    stixBundle = investigationToStix(target, findings);
  } catch {}

  // Count entities
  let entitiesFound = 0;
  for (const data of Object.values(findings)) {
    entitiesFound += (data?.subdomains?.length || 0) + (data?.openPorts?.filter((p: any) => p.state === "open")?.length || 0) + (data?.foundProfiles?.length || 0);
  }

  return {
    target,
    plan: { phases: plan.phases },
    findings,
    multiDimensionScore,
    correlations,
    nextSteps,
    report,
    stixBundle,
    stats: { modulesRun, modulesSucceeded, entitiesFound, durationMs: Date.now() - start },
    timestamp: new Date().toISOString(),
  };
}

async function executeModule(module: string, target: string): Promise<any> {
  switch (module) {
    case "domain_recon": { const { fullDomainRecon } = await import("./domain-recon.js"); return fullDomainRecon(target); }
    case "network_recon": { const { fullNetworkRecon } = await import("./network-recon.js"); return fullNetworkRecon(target); }
    case "identity_recon": { const { fullIdentityRecon } = await import("./identity-recon.js"); return fullIdentityRecon(target); }
    case "web_intel": { const { fullWebIntel } = await import("./web-intel.js"); return fullWebIntel(target.startsWith("http") ? target : `https://${target}`); }
    case "threat_intel": { const { fullThreatCheck } = await import("./threat-intel.js"); return fullThreatCheck(target); }
    case "asn_lookup": { const { fullNetworkIntel } = await import("./reverse-ip.js"); return fullNetworkIntel(target); }
    case "breach_check": { const { fullBreachCheck } = await import("./breach-check.js"); return fullBreachCheck(target); }
    case "github_recon": { const { fullGithubRecon } = await import("./github-recon.js"); return fullGithubRecon(target); }
    case "js_analyzer": { const { analyzeJavaScript } = await import("./js-analyzer.js"); return analyzeJavaScript(target.startsWith("http") ? target : `https://${target}`); }
    case "waf_detect": { const { detectWaf } = await import("./waf-detect.js"); return detectWaf(target.startsWith("http") ? target : `https://${target}`); }
    case "subdomain_takeover": { const { checkTakeover } = await import("./subdomain-takeover.js"); return checkTakeover(target); }
    case "cve_matcher": { const { matchCves } = await import("./cve-matcher.js"); return matchCves([]); }
    case "cloud_enum": { const { enumerateCloud } = await import("./cloud-enum.js"); return enumerateCloud(target); }
    case "api_discovery": { const { discoverApis } = await import("./api-discovery.js"); return discoverApis(target.startsWith("http") ? target : `https://${target}`); }
    case "company_intel": { const { domainToCompany } = await import("./company-intel.js"); return domainToCompany(target); }
    case "news_collector": { const { collectNews } = await import("./news-collector.js"); return collectNews(target, { maxPerSource: 3 }); }
    case "social_media": { const { collectSocialMedia } = await import("./social-media.js"); return collectSocialMedia(target); }
    case "blockchain": { const { analyzeBlockchainAddress } = await import("./blockchain.js"); return analyzeBlockchainAddress(target); }
    case "sanctions": { const { checkSanctions } = await import("./sanctions.js"); return checkSanctions(target); }
    // Extended modules
    case "email_security": { const { analyzeEmailSecurity } = await import("./protocol-analysis.js"); return analyzeEmailSecurity(target); }
    case "nmap_scan": { const { nmapQuickScan } = await import("./nmap-scanner.js"); return nmapQuickScan(target); }
    case "url_safety": { const { checkUrlSafety } = await import("./safebrowsing.js"); return checkUrlSafety(target.startsWith("http") ? target : `https://${target}`); }
    case "email_harvest": { const { harvestEmails } = await import("./email-harvester.js"); return harvestEmails(target); }
    case "attribution": { const { attributeTarget } = await import("./attribution.js"); return attributeTarget(target); }
    case "temporal": { const { analyzeTemporalProfile } = await import("./temporal-analysis.js"); return analyzeTemporalProfile(target); }
    case "pivot": { const { autoPivot } = await import("./pivot-engine.js"); return autoPivot("domain", target, { maxDepth: 2, maxPivots: 8 }); }
    case "dir_scan": { const { dirBruteforce } = await import("./dir-bruteforce.js"); return dirBruteforce(target.startsWith("http") ? target : `https://${target}`); }
    case "twitter": { const { searchTwitter } = await import("./twitter-intel.js"); return searchTwitter(target, { sentiment: true }); }
    case "blogs": { const { monitorOfficialBlogs } = await import("./media-collector.js"); return monitorOfficialBlogs([target.split(".")[0]]); }
    case "geospatial": { const { geocode } = await import("./geospatial.js"); return geocode(target); }
    default: return null;
  }
}
