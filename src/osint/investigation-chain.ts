/**
 * Investigation Chain — multi-step automated OSINT workflows
 * Chain modules together: domain → subdomains → port scan → screenshot → report
 */

export type ChainStepType =
  | "domain_recon" | "network_recon" | "identity_recon" | "web_intel"
  | "threat_check" | "asn_lookup" | "port_scan" | "subdomain_enum"
  | "crawl" | "screenshot" | "breach_check" | "github_recon"
  | "dork_execute" | "doc_scan" | "ssl_analysis";

export interface ChainStep {
  id: string;
  type: ChainStepType;
  target?: string;       // Override target (else inherit from chain)
  targetFrom?: string;   // Use output of another step as target
  options?: Record<string, any>;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  result?: any;
  error?: string;
  durationMs?: number;
}

export interface ChainDefinition {
  name: string;
  description: string;
  steps: Omit<ChainStep, "status" | "result" | "error" | "durationMs">[];
}

export interface ChainResult {
  name: string;
  target: string;
  steps: ChainStep[];
  totalDurationMs: number;
  status: "completed" | "partial" | "failed";
  timestamp: string;
}

export type ChainProgressCallback = (step: ChainStep, index: number, total: number) => void;

// ── Built-in Chain Templates ────────────────────────────

export const CHAIN_TEMPLATES: Record<string, ChainDefinition> = {
  "full-domain": {
    name: "Full Domain Investigation",
    description: "Complete domain recon → network scan → web intel → threat check → report",
    steps: [
      { id: "domain", type: "domain_recon" },
      { id: "network", type: "network_recon" },
      { id: "web", type: "web_intel" },
      { id: "threat", type: "threat_check" },
      { id: "ssl", type: "ssl_analysis" },
      { id: "dorks", type: "dork_execute" },
    ],
  },
  "deep-subdomain": {
    name: "Deep Subdomain Sweep",
    description: "Discover subdomains → port scan each → screenshot live ones",
    steps: [
      { id: "subs", type: "subdomain_enum" },
      { id: "ports", type: "port_scan", targetFrom: "subs" },
    ],
  },
  "identity-deep": {
    name: "Deep Identity Investigation",
    description: "Username enum → breach check → GitHub scan → social graph",
    steps: [
      { id: "identity", type: "identity_recon" },
      { id: "breach", type: "breach_check" },
      { id: "github", type: "github_recon" },
    ],
  },
  "infrastructure-map": {
    name: "Infrastructure Mapping",
    description: "Domain → ASN → reverse IP → port scan → banner grab",
    steps: [
      { id: "domain", type: "domain_recon" },
      { id: "asn", type: "asn_lookup" },
      { id: "network", type: "network_recon" },
    ],
  },
  "web-exposure": {
    name: "Web Exposure Audit",
    description: "Crawl site → doc scan → dork search → threat check",
    steps: [
      { id: "crawl", type: "crawl" },
      { id: "docs", type: "doc_scan" },
      { id: "dorks", type: "dork_execute" },
      { id: "threat", type: "threat_check" },
    ],
  },
};

// ── Chain Executor ──────────────────────────────────────

export async function executeChain(
  chain: ChainDefinition,
  target: string,
  onProgress?: ChainProgressCallback
): Promise<ChainResult> {
  const start = Date.now();
  const steps: ChainStep[] = chain.steps.map(s => ({
    ...s,
    status: "pending" as const,
  }));

  let failCount = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    step.status = "running";
    onProgress?.(step, i, steps.length);

    const stepStart = Date.now();
    const stepTarget = step.target || target;

    try {
      step.result = await executeStep(step.type, stepTarget, step.options);
      step.status = "done";
    } catch (err) {
      step.error = err instanceof Error ? err.message : String(err);
      step.status = "failed";
      failCount++;
    }

    step.durationMs = Date.now() - stepStart;
    onProgress?.(step, i, steps.length);
  }

  return {
    name: chain.name,
    target,
    steps,
    totalDurationMs: Date.now() - start,
    status: failCount === 0 ? "completed" : failCount === steps.length ? "failed" : "partial",
    timestamp: new Date().toISOString(),
  };
}

async function executeStep(type: ChainStepType, target: string, options?: Record<string, any>): Promise<any> {
  switch (type) {
    case "domain_recon": {
      const { fullDomainRecon } = await import("./domain-recon.js");
      return fullDomainRecon(target);
    }
    case "network_recon": {
      const { fullNetworkRecon } = await import("./network-recon.js");
      return fullNetworkRecon(target);
    }
    case "identity_recon": {
      const { fullIdentityRecon } = await import("./identity-recon.js");
      return fullIdentityRecon(target);
    }
    case "web_intel": {
      const { fullWebIntel } = await import("./web-intel.js");
      const url = target.startsWith("http") ? target : `https://${target}`;
      return fullWebIntel(url);
    }
    case "threat_check": {
      const { fullThreatCheck } = await import("./threat-intel.js");
      return fullThreatCheck(target);
    }
    case "asn_lookup": {
      const { fullNetworkIntel } = await import("./reverse-ip.js");
      return fullNetworkIntel(target);
    }
    case "port_scan": {
      const { portScan } = await import("./network-recon.js");
      return portScan(target, options?.ports);
    }
    case "subdomain_enum": {
      const { subdomainBruteforce } = await import("./advanced-recon.js");
      return subdomainBruteforce(target);
    }
    case "crawl": {
      const { crawlSite } = await import("./crawler.js");
      const url = target.startsWith("http") ? target : `https://${target}`;
      return crawlSite(url, { maxPages: options?.maxPages || 20 });
    }
    case "screenshot": {
      const { captureScreenshot } = await import("./crawler.js");
      const url = target.startsWith("http") ? target : `https://${target}`;
      return captureScreenshot(url);
    }
    case "breach_check": {
      const { fullBreachCheck } = await import("./breach-check.js");
      return fullBreachCheck(target);
    }
    case "github_recon": {
      const { fullGithubRecon } = await import("./github-recon.js");
      return fullGithubRecon(target);
    }
    case "dork_execute": {
      const { executeDorkSuite } = await import("./dork-executor.js");
      return executeDorkSuite(target);
    }
    case "doc_scan": {
      const { fullDocScan } = await import("./doc-scanner.js");
      return fullDocScan(target);
    }
    case "ssl_analysis": {
      const { sslDeepAnalysis } = await import("./advanced-recon.js");
      return sslDeepAnalysis(target);
    }
    default:
      throw new Error(`Unknown chain step type: ${type}`);
  }
}
