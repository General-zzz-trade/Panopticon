/**
 * OSINT Report Generator — Markdown/JSON investigation reports
 */

import type { DomainReconResult } from "./domain-recon.js";
import type { NetworkReconResult } from "./network-recon.js";
import type { IdentityReconResult } from "./identity-recon.js";
import type { WebIntelResult } from "./web-intel.js";
import type { IntelGraph } from "./data-correlator.js";

export interface OsintReport {
  title: string;
  target: string;
  investigator: string;
  timestamp: string;
  sections: ReportSection[];
  riskLevel: "low" | "medium" | "high" | "critical";
  riskFactors: string[];
  recommendations: string[];
  markdown: string;
  json: object;
}

interface ReportSection {
  title: string;
  content: string;
  findings: string[];
  severity: "info" | "low" | "medium" | "high";
}

// ── Risk Assessment ─────────────────────────────────────

function assessRisk(data: {
  domain?: DomainReconResult;
  network?: NetworkReconResult;
  identity?: IdentityReconResult;
  web?: WebIntelResult;
}): { level: "low" | "medium" | "high" | "critical"; factors: string[] } {
  const factors: string[] = [];
  let score = 0;

  // Domain risks
  if (data.domain) {
    if (data.domain.zoneTransfer.success) {
      factors.push("DNS zone transfer is enabled (critical information leak)");
      score += 30;
    }
    if (!data.domain.whois.registrar) {
      factors.push("WHOIS data is redacted or unavailable");
      score += 5;
    }
    if (data.domain.subdomains.length > 50) {
      factors.push(`Large attack surface: ${data.domain.subdomains.length} subdomains discovered`);
      score += 10;
    }
  }

  // Network risks
  if (data.network) {
    const dangerousPorts = data.network.openPorts.filter(p =>
      [21, 23, 135, 139, 445, 1433, 3389, 5900, 27017, 6379, 11211].includes(p.port)
    );
    if (dangerousPorts.length > 0) {
      factors.push(`Risky open ports: ${dangerousPorts.map(p => `${p.port}(${p.service})`).join(", ")}`);
      score += dangerousPorts.length * 10;
    }

    if (data.network.httpHeaders) {
      const sec = data.network.httpHeaders.securityHeaders;
      const missing = [];
      if (!sec.hsts) missing.push("HSTS");
      if (!sec.csp) missing.push("CSP");
      if (!sec.xFrameOptions) missing.push("X-Frame-Options");
      if (!sec.xContentType) missing.push("X-Content-Type-Options");
      if (missing.length > 0) {
        factors.push(`Missing security headers: ${missing.join(", ")}`);
        score += missing.length * 3;
      }
    }

    if (data.network.banners.some(b => b.banner.includes("debug") || b.banner.includes("DEBUG"))) {
      factors.push("Debug information exposed in service banners");
      score += 15;
    }
  }

  // Web risks
  if (data.web) {
    if (data.web.robots.disallowed.some(d => d.includes("admin") || d.includes("backup"))) {
      factors.push("Sensitive paths disclosed in robots.txt");
      score += 5;
    }
    if (data.web.techStack.cms && ["WordPress", "Drupal", "Joomla"].includes(data.web.techStack.cms)) {
      factors.push(`CMS detected: ${data.web.techStack.cms} (common attack target)`);
      score += 5;
    }
  }

  // Identity risks
  if (data.identity) {
    if (data.identity.foundProfiles.length > 10) {
      factors.push(`High digital footprint: ${data.identity.foundProfiles.length} profiles found`);
      score += 5;
    }
    if (data.identity.emailValidation?.disposable) {
      factors.push("Disposable email address detected");
      score += 10;
    }
  }

  const level = score >= 50 ? "critical" : score >= 30 ? "high" : score >= 15 ? "medium" : "low";
  return { level, factors };
}

// ── Recommendations ─────────────────────────────────────

function generateRecommendations(data: {
  domain?: DomainReconResult;
  network?: NetworkReconResult;
  web?: WebIntelResult;
}): string[] {
  const recs: string[] = [];

  if (data.domain?.zoneTransfer.success) {
    recs.push("CRITICAL: Disable DNS zone transfers immediately on all nameservers");
  }

  if (data.network) {
    const risky = data.network.openPorts.filter(p => [23, 21, 135, 139, 445].includes(p.port));
    if (risky.length > 0) {
      recs.push(`Close unnecessary ports: ${risky.map(p => p.port).join(", ")} or restrict with firewall rules`);
    }

    if (data.network.httpHeaders) {
      const sec = data.network.httpHeaders.securityHeaders;
      if (!sec.hsts) recs.push("Enable HSTS (Strict-Transport-Security header)");
      if (!sec.csp) recs.push("Implement Content-Security-Policy header");
      if (!sec.xFrameOptions) recs.push("Add X-Frame-Options header to prevent clickjacking");
    }
  }

  if (data.domain && data.domain.subdomains.length > 20) {
    recs.push("Audit all subdomains for unused/stale entries and remove them");
  }

  if (data.web?.techStack.cms) {
    recs.push(`Keep ${data.web.techStack.cms} and all plugins up to date`);
  }

  return recs;
}

// ── Markdown Generation ─────────────────────────────────

function generateMarkdown(report: Omit<OsintReport, "markdown" | "json">): string {
  const lines: string[] = [];

  lines.push(`# ${report.title}`);
  lines.push("");
  lines.push(`**Target:** ${report.target}`);
  lines.push(`**Date:** ${new Date(report.timestamp).toLocaleDateString()}`);
  lines.push(`**Risk Level:** ${report.riskLevel.toUpperCase()}`);
  lines.push("");

  // Executive Summary
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(`This report presents the results of an OSINT investigation on **${report.target}**.`);
  lines.push(`The overall risk assessment is **${report.riskLevel}** based on ${report.riskFactors.length} identified risk factors.`);
  lines.push("");

  // Risk Factors
  if (report.riskFactors.length > 0) {
    lines.push("## Risk Factors");
    lines.push("");
    for (const factor of report.riskFactors) {
      lines.push(`- ${factor}`);
    }
    lines.push("");
  }

  // Sections
  for (const section of report.sections) {
    lines.push(`## ${section.title}`);
    lines.push("");
    if (section.content) {
      lines.push(section.content);
      lines.push("");
    }
    if (section.findings.length > 0) {
      lines.push("**Key Findings:**");
      lines.push("");
      for (const finding of section.findings) {
        lines.push(`- ${finding}`);
      }
      lines.push("");
    }
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push("## Recommendations");
    lines.push("");
    for (let i = 0; i < report.recommendations.length; i++) {
      lines.push(`${i + 1}. ${report.recommendations[i]}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(`*Generated by Panopticon at ${report.timestamp}*`);

  return lines.join("\n");
}

// ── Domain Section ──────────────────────────────────────

function buildDomainSection(data: DomainReconResult): ReportSection {
  const findings: string[] = [];

  if (data.whois.registrar) findings.push(`Registrar: ${data.whois.registrar}`);
  if (data.whois.createdDate) findings.push(`Created: ${data.whois.createdDate}`);
  if (data.whois.expiryDate) findings.push(`Expires: ${data.whois.expiryDate}`);
  if (data.whois.registrantOrg) findings.push(`Organization: ${data.whois.registrantOrg}`);
  if (data.whois.registrantCountry) findings.push(`Country: ${data.whois.registrantCountry}`);
  findings.push(`Name Servers: ${data.whois.nameServers.join(", ") || "N/A"}`);
  findings.push(`DNS Records: ${data.dns.length} records found`);
  findings.push(`Subdomains: ${data.subdomains.length} discovered`);
  findings.push(`Certificates: ${data.certificates.length} found via CT logs`);
  if (data.zoneTransfer.success) {
    findings.push(`⚠️ Zone Transfer ENABLED — ${data.zoneTransfer.records.length} records leaked`);
  }

  const content = [
    `### DNS Records`,
    "",
    "| Type | Value |",
    "|------|-------|",
    ...data.dns.slice(0, 20).map(r => `| ${r.type} | ${r.value} |`),
    "",
  ];

  if (data.subdomains.length > 0) {
    content.push("### Subdomains", "");
    content.push("| Subdomain | Source | IP |");
    content.push("|-----------|--------|-----|");
    for (const sub of data.subdomains.slice(0, 30)) {
      content.push(`| ${sub.subdomain} | ${sub.source} | ${sub.ip || "N/A"} |`);
    }
    content.push("");
  }

  return {
    title: "Domain Intelligence",
    content: content.join("\n"),
    findings,
    severity: data.zoneTransfer.success ? "high" : "info",
  };
}

// ── Network Section ─────────────────────────────────────

function buildNetworkSection(data: NetworkReconResult): ReportSection {
  const findings: string[] = [];

  if (data.resolvedIp) findings.push(`Resolved IP: ${data.resolvedIp}`);
  if (data.geo) {
    findings.push(`Location: ${[data.geo.city, data.geo.region, data.geo.country].filter(Boolean).join(", ")}`);
    if (data.geo.org) findings.push(`Organization: ${data.geo.org}`);
    if (data.geo.isp) findings.push(`ISP: ${data.geo.isp}`);
    if (data.geo.as) findings.push(`AS: ${data.geo.as}`);
  }

  const openPorts = data.openPorts.filter(p => p.state === "open");
  findings.push(`Open Ports: ${openPorts.length} found`);

  if (data.httpHeaders?.server) findings.push(`Server: ${data.httpHeaders.server}`);

  const content = [
    "### Open Ports",
    "",
    "| Port | Service | Banner |",
    "|------|---------|--------|",
    ...openPorts.map(p => `| ${p.port} | ${p.service || "Unknown"} | ${(p.banner || "").slice(0, 60)} |`),
    "",
  ];

  if (data.httpHeaders) {
    const sec = data.httpHeaders.securityHeaders;
    content.push("### Security Headers", "");
    content.push("| Header | Status |");
    content.push("|--------|--------|");
    content.push(`| HSTS | ${sec.hsts ? "✅" : "❌"} |`);
    content.push(`| CSP | ${sec.csp ? "✅" : "❌"} |`);
    content.push(`| X-Frame-Options | ${sec.xFrameOptions ? "✅" : "❌"} |`);
    content.push(`| X-Content-Type | ${sec.xContentType ? "✅" : "❌"} |`);
    content.push(`| Referrer-Policy | ${sec.referrerPolicy ? "✅" : "❌"} |`);
    content.push("");
  }

  const hasDangerous = openPorts.some(p => [23, 21, 135, 445].includes(p.port));
  return {
    title: "Network Intelligence",
    content: content.join("\n"),
    findings,
    severity: hasDangerous ? "high" : "low",
  };
}

// ── Identity Section ────────────────────────────────────

function buildIdentitySection(data: IdentityReconResult): ReportSection {
  const findings: string[] = [];

  findings.push(`Query: ${data.query} (${data.queryType})`);
  findings.push(`Platforms checked: ${data.platformCount}`);
  findings.push(`Profiles found: ${data.foundProfiles.length} (${data.hitRate})`);

  if (data.emailValidation) {
    findings.push(`Email format valid: ${data.emailValidation.format ? "Yes" : "No"}`);
    findings.push(`MX records: ${data.emailValidation.mxRecords.length > 0 ? data.emailValidation.mxRecords.join(", ") : "None"}`);
    findings.push(`Disposable: ${data.emailValidation.disposable ? "Yes" : "No"}`);
    findings.push(`Role account: ${data.emailValidation.role ? "Yes" : "No"}`);
    if (data.emailValidation.smtpReachable !== undefined) {
      findings.push(`SMTP reachable: ${data.emailValidation.smtpReachable ? "Yes" : "No"}`);
    }
  }

  const content = [
    "### Discovered Profiles",
    "",
    "| Platform | URL |",
    "|----------|-----|",
    ...data.foundProfiles.map(p => `| ${p.platform} | ${p.url} |`),
    "",
  ];

  return {
    title: "Identity Intelligence",
    content: content.join("\n"),
    findings,
    severity: "info",
  };
}

// ── Web Intel Section ───────────────────────────────────

function buildWebIntelSection(data: WebIntelResult): ReportSection {
  const findings: string[] = [];

  if (data.techStack.server) findings.push(`Server: ${data.techStack.server}`);
  if (data.techStack.cms) findings.push(`CMS: ${data.techStack.cms}`);
  if (data.techStack.framework) findings.push(`Framework: ${data.techStack.framework}`);
  if (data.techStack.cdn) findings.push(`CDN: ${data.techStack.cdn}`);
  if (data.techStack.hosting) findings.push(`Hosting: ${data.techStack.hosting}`);
  if (data.techStack.javascript.length) findings.push(`JS: ${data.techStack.javascript.join(", ")}`);
  if (data.techStack.analytics.length) findings.push(`Analytics: ${data.techStack.analytics.join(", ")}`);
  if (data.techStack.security.length) findings.push(`Security: ${data.techStack.security.join(", ")}`);

  findings.push(`Wayback snapshots: ${data.wayback.totalSnapshots}`);
  if (data.wayback.firstSeen) findings.push(`First seen: ${data.wayback.firstSeen}`);
  findings.push(`Links: ${data.links.internal} internal, ${data.links.external} external`);

  const content = [
    "### Google Dork Queries",
    "",
    "Use these queries in Google to find additional information:",
    "",
    ...Object.entries(data.dorks).map(([name, query]) => `- **${name}**: \`${query}\``),
    "",
    `### Robots.txt Analysis`,
    "",
    `Disallowed paths: ${data.robots.disallowed.length}`,
    "",
    ...data.robots.disallowed.slice(0, 20).map(d => `- ${d}`),
    "",
  ];

  return {
    title: "Web Intelligence",
    content: content.join("\n"),
    findings,
    severity: "info",
  };
}

// ── Graph Section ───────────────────────────────────────

function buildGraphSection(graph: IntelGraph): ReportSection {
  const data = graph.toJSON() as any;
  const findings: string[] = [];

  findings.push(`Entities: ${data.stats.entityCount}`);
  findings.push(`Relations: ${data.stats.relationCount}`);
  findings.push(`Clusters: ${data.stats.clusters}`);
  findings.push(`Timeline events: ${data.stats.timelineEvents}`);

  // Entity breakdown
  const typeCounts: Record<string, number> = {};
  for (const entity of data.entities) {
    typeCounts[entity.type] = (typeCounts[entity.type] || 0) + 1;
  }

  const content = [
    "### Entity Breakdown",
    "",
    "| Type | Count |",
    "|------|-------|",
    ...Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => `| ${type} | ${count} |`),
    "",
    "### Key Relations",
    "",
    ...data.relations.slice(0, 20).map((r: any) => {
      const src = data.entities.find((e: any) => e.id === r.sourceId);
      const tgt = data.entities.find((e: any) => e.id === r.targetId);
      return `- ${src?.value || r.sourceId} → **${r.type}** → ${tgt?.value || r.targetId}`;
    }),
    "",
  ];

  return {
    title: "Intelligence Graph",
    content: content.join("\n"),
    findings,
    severity: "info",
  };
}

// ── Main Report Generator ───────────────────────────────

export function generateReport(
  target: string,
  data: {
    domain?: DomainReconResult;
    network?: NetworkReconResult;
    identity?: IdentityReconResult;
    web?: WebIntelResult;
    graph?: IntelGraph;
  }
): OsintReport {
  const sections: ReportSection[] = [];

  if (data.domain) sections.push(buildDomainSection(data.domain));
  if (data.network) sections.push(buildNetworkSection(data.network));
  if (data.identity) sections.push(buildIdentitySection(data.identity));
  if (data.web) sections.push(buildWebIntelSection(data.web));
  if (data.graph) sections.push(buildGraphSection(data.graph));

  const risk = assessRisk(data);
  const recommendations = generateRecommendations(data);

  const reportBase = {
    title: `OSINT Investigation Report: ${target}`,
    target,
    investigator: "Panopticon",
    timestamp: new Date().toISOString(),
    sections,
    riskLevel: risk.level,
    riskFactors: risk.factors,
    recommendations,
  };

  const markdown = generateMarkdown(reportBase);

  const json = {
    ...reportBase,
    rawData: {
      domain: data.domain,
      network: data.network,
      identity: data.identity,
      web: data.web,
      graph: data.graph?.toJSON(),
    },
  };

  return { ...reportBase, markdown, json };
}
