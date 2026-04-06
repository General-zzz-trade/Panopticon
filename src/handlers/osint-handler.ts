/**
 * OSINT Handler — dispatches OSINT reconnaissance tasks
 * Integrates with the agent runtime via the standard handler interface
 */

import type { RunContext, AgentTask } from "../types.js";

interface TaskExecutionOutput {
  summary: string;
  artifacts?: any[];
  stateHints?: string[];
  observationHints?: string[];
}

export async function handleOsintTask(
  context: RunContext,
  task: AgentTask,
): Promise<TaskExecutionOutput> {
  // Lazy import to avoid loading OSINT modules until needed
  const osint = await import("../osint/index.js");

  const target = String(task.payload.target ?? task.payload.domain ?? task.payload.query ?? "");
  if (!target) throw new Error("osint: target is required in payload");

  const taskType = task.type;

  try {
    if (taskType === "osint_investigate") {
      // Full investigation — auto-detect target type
      const investigationType = task.payload.type
        ? String(task.payload.type) as any
        : undefined;

      const result = await osint.investigate(target, investigationType);

      context.artifacts.push({
        type: "osint_report",
        path: `osint/${task.id}/report.md`,
        description: `OSINT report for ${target}`,
        taskId: task.id,
      } as any);

      context.artifacts.push({
        type: "osint_data",
        path: `osint/${task.id}/data.json`,
        description: `OSINT raw data for ${target}`,
        taskId: task.id,
      } as any);

      return {
        summary: `OSINT investigation completed for ${target}. Risk: ${result.report.riskLevel}. ` +
          `Found ${(result.graph as any).stats?.entityCount || 0} entities, ` +
          `${(result.graph as any).stats?.relationCount || 0} relations. ` +
          `Duration: ${result.durationMs}ms.`,
        stateHints: [
          `osint_target:${target}`,
          `osint_risk:${result.report.riskLevel}`,
          `osint_entities:${(result.graph as any).stats?.entityCount || 0}`,
        ],
        observationHints: result.report.riskFactors.slice(0, 5),
      };
    }

    if (taskType === "osint_domain") {
      const result = await osint.fullDomainRecon(target);

      context.artifacts.push({
        type: "osint_domain",
        path: `osint/${task.id}/domain.json`,
        description: `Domain recon for ${target}`,
        taskId: task.id,
      });

      return {
        summary: `Domain recon for ${target}: ` +
          `${result.dns.length} DNS records, ` +
          `${result.subdomains.length} subdomains, ` +
          `${result.certificates.length} certificates. ` +
          `Registrar: ${result.whois.registrar || "Unknown"}. ` +
          `Zone transfer: ${result.zoneTransfer.success ? "ENABLED (vulnerability!)" : "disabled"}.`,
        stateHints: [
          `domain:${target}`,
          `subdomains:${result.subdomains.length}`,
          `zone_transfer:${result.zoneTransfer.success}`,
        ],
      };
    }

    if (taskType === "osint_network") {
      const result = await osint.fullNetworkRecon(target);
      const openPorts = result.openPorts.filter(p => p.state === "open");

      return {
        summary: `Network recon for ${target}: ` +
          `IP ${result.resolvedIp || target}. ` +
          `${openPorts.length} open ports: ${openPorts.map(p => `${p.port}(${p.service || "?"})`).join(", ")}. ` +
          `Location: ${[result.geo?.city, result.geo?.country].filter(Boolean).join(", ") || "Unknown"}.`,
        stateHints: [
          `target_ip:${result.resolvedIp || target}`,
          `open_ports:${openPorts.length}`,
          `country:${result.geo?.country || "unknown"}`,
        ],
      };
    }

    if (taskType === "osint_identity") {
      const result = await osint.fullIdentityRecon(target);

      return {
        summary: `Identity recon for "${target}": ` +
          `${result.foundProfiles.length}/${result.platformCount} platforms matched. ` +
          `Found on: ${result.foundProfiles.map(p => p.platform).join(", ") || "none"}. ` +
          (result.emailValidation
            ? `Email MX: ${result.emailValidation.mxRecords.length > 0 ? "valid" : "none"}. ` +
              `Disposable: ${result.emailValidation.disposable ? "yes" : "no"}.`
            : ""),
        stateHints: [
          `identity:${target}`,
          `profiles_found:${result.foundProfiles.length}`,
        ],
      };
    }

    if (taskType === "osint_web") {
      const url = target.startsWith("http") ? target : `https://${target}`;
      const result = await osint.fullWebIntel(url);

      return {
        summary: `Web intel for ${target}: ` +
          `Server: ${result.techStack.server || "unknown"}. ` +
          `CMS: ${result.techStack.cms || "none"}. ` +
          `JS: ${result.techStack.javascript.join(", ") || "none"}. ` +
          `CDN: ${result.techStack.cdn || "none"}. ` +
          `Wayback snapshots: ${result.wayback.totalSnapshots}. ` +
          `Links: ${result.links.internal} internal, ${result.links.external} external.`,
        stateHints: [
          `web_target:${url}`,
          `server:${result.techStack.server || "unknown"}`,
          `wayback:${result.wayback.totalSnapshots}`,
        ],
      };
    }

    if (taskType === "osint_threat") {
      const { fullThreatCheck } = await import("../osint/threat-intel.js");
      const result = await fullThreatCheck(target);
      return {
        summary: `Threat check for ${target}: risk score ${result.riskScore}/100. ` +
          `Malicious: ${result.malicious}. Threats: ${result.threats.length}. ` +
          `Blacklisted on: ${result.blacklists.filter(b => b.listed).length} DNSBLs. ` +
          `SSL issues: ${result.sslIssues.length}. Suspicious patterns: ${result.suspiciousPatterns.length}.`,
        stateHints: [`threat_risk:${result.riskScore}`, `malicious:${result.malicious}`],
      };
    }

    if (taskType === "osint_asn") {
      const { fullNetworkIntel } = await import("../osint/reverse-ip.js");
      const result = await fullNetworkIntel(target);
      return {
        summary: `ASN/Network intel for ${target}: ` +
          `ASN: ${result.asn.asn} (${result.asn.name}). ` +
          `CIDR: ${result.asn.cidr || "N/A"}. ` +
          `Reverse IP: ${result.reverseIp.domains.length} co-hosted domains. ` +
          `Prefixes: ${result.prefixes.prefixes.length} announced.`,
        stateHints: [`asn:${result.asn.asn}`, `cohosted:${result.reverseIp.domains.length}`],
      };
    }

    if (taskType === "osint_crawl") {
      const { crawlSite } = await import("../osint/crawler.js");
      const url = target.startsWith("http") ? target : `https://${target}`;
      const maxPages = Number(task.payload.maxPages ?? 20);
      const result = await crawlSite(url, { maxPages, maxDepth: 3 });
      return {
        summary: `Crawled ${target}: ${result.stats.pagesVisited} pages, ` +
          `${result.stats.totalLinks} links, ${result.stats.totalForms} forms, ` +
          `${result.stats.totalEmails} emails found, ${result.externalDomains.length} external domains. ` +
          `Duration: ${result.stats.durationMs}ms.`,
        stateHints: [`crawl_pages:${result.stats.pagesVisited}`, `crawl_emails:${result.stats.totalEmails}`],
      };
    }

    if (taskType === "osint_breach") {
      const { fullBreachCheck } = await import("../osint/breach-check.js");
      const result = await fullBreachCheck(target);
      return {
        summary: `Breach check for "${target}": ` +
          `Breached: ${result.breached}. ` +
          (result.pwnedCount ? `Found in ${result.pwnedCount} leaked datasets. ` : "") +
          (result.passwordStrength ? `Strength: ${result.passwordStrength.score}, entropy: ${result.passwordStrength.entropy} bits. ` : "") +
          `Known breaches: ${result.breaches.length}.`,
        stateHints: [`breached:${result.breached}`],
      };
    }

    if (taskType === "osint_screenshot") {
      const { captureScreenshot } = await import("../osint/crawler.js");
      const url = target.startsWith("http") ? target : `https://${target}`;
      const result = await captureScreenshot(url);
      return {
        summary: result.error
          ? `Screenshot failed for ${target}: ${result.error}`
          : `Screenshot captured for ${target}: ${result.viewportWidth}x${result.viewportHeight}, full page height: ${result.fullPageHeight}px.`,
        stateHints: [`screenshot:${result.error ? "failed" : "captured"}`],
      };
    }

    throw new Error(`osint: unknown task type "${taskType}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`osint: ${taskType} failed for "${target}": ${msg}`);
  }
}
