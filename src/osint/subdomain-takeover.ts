/**
 * Subdomain Takeover Detection — check if CNAME points to unclaimed services
 * Detects dangling DNS records that could be hijacked
 */

import { execFileNoThrow } from "../utils/execFileNoThrow.js";

export interface TakeoverResult {
  subdomain: string;
  vulnerable: boolean;
  cname?: string;
  service?: string;
  evidence?: string;
  severity: "critical" | "high" | "info";
}

// Fingerprints: CNAME pattern → service name → response body signature when unclaimed
const TAKEOVER_FINGERPRINTS: { service: string; cnames: RegExp; bodySignature: string[] }[] = [
  { service: "GitHub Pages", cnames: /\.github\.io$/i, bodySignature: ["There isn't a GitHub Pages site here", "For root URLs"] },
  { service: "Heroku", cnames: /\.herokuapp\.com$|\.herokudns\.com$/i, bodySignature: ["No such app", "herokucdn.com/error-pages"] },
  { service: "AWS S3", cnames: /\.s3\.amazonaws\.com$|\.s3-website/i, bodySignature: ["NoSuchBucket", "The specified bucket does not exist"] },
  { service: "Shopify", cnames: /\.myshopify\.com$/i, bodySignature: ["Sorry, this shop is currently unavailable", "only works with"] },
  { service: "Tumblr", cnames: /\.tumblr\.com$/i, bodySignature: ["There's nothing here", "Whatever you were looking for"] },
  { service: "WordPress.com", cnames: /\.wordpress\.com$/i, bodySignature: ["Do you want to register"] },
  { service: "Pantheon", cnames: /\.pantheonsite\.io$/i, bodySignature: ["404 error unknown site", "The gods are wise"] },
  { service: "Fastly", cnames: /\.fastly\.net$/i, bodySignature: ["Fastly error: unknown domain"] },
  { service: "Ghost", cnames: /\.ghost\.io$/i, bodySignature: ["The thing you were looking for is no longer here"] },
  { service: "Surge.sh", cnames: /\.surge\.sh$/i, bodySignature: ["project not found"] },
  { service: "Netlify", cnames: /\.netlify\.app$|\.netlify\.com$/i, bodySignature: ["Not Found - Request ID"] },
  { service: "Fly.io", cnames: /\.fly\.dev$/i, bodySignature: ["404 Not Found"] },
  { service: "Vercel", cnames: /\.vercel\.app$/i, bodySignature: ["The deployment could not be found"] },
  { service: "Azure", cnames: /\.azurewebsites\.net$|\.cloudapp\.azure\.com$|\.trafficmanager\.net$/i, bodySignature: ["404 Web Site not found", "This Azure App Service app has been stopped"] },
  { service: "Bitbucket", cnames: /\.bitbucket\.io$/i, bodySignature: ["Repository not found"] },
  { service: "Cargo Collective", cnames: /\.cargocollective\.com$/i, bodySignature: ["If you're moving your domain"] },
  { service: "HubSpot", cnames: /\.hubspot\.net$/i, bodySignature: ["This page isn't available"] },
  { service: "Zendesk", cnames: /\.zendesk\.com$/i, bodySignature: ["Help Center Closed", "Oops, this help center"] },
  { service: "Unbounce", cnames: /\.unbouncepages\.com$/i, bodySignature: ["The requested URL was not found"] },
  { service: "Tilda", cnames: /\.tilda\.ws$/i, bodySignature: ["Please renew your subscription"] },
];

// ── Check single subdomain for takeover ─────────────────

export async function checkTakeover(subdomain: string): Promise<TakeoverResult> {
  const clean = subdomain.replace(/[^a-zA-Z0-9.\-]/g, "");
  const result: TakeoverResult = { subdomain: clean, vulnerable: false, severity: "info" };

  // Get CNAME record
  const { stdout } = await execFileNoThrow("dig", ["+short", clean, "CNAME"], { timeoutMs: 5000 });
  const cname = stdout.trim().replace(/\.$/, "");

  if (!cname) return result;
  result.cname = cname;

  // Check against fingerprints
  for (const fp of TAKEOVER_FINGERPRINTS) {
    if (!fp.cnames.test(cname)) continue;

    result.service = fp.service;

    // Try to fetch the page and check for unclaimed signatures
    try {
      const response = await fetch(`https://${clean}`, {
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OSINT-Takeover-Check/1.0)" },
      });

      const body = await response.text();

      for (const sig of fp.bodySignature) {
        if (body.includes(sig)) {
          result.vulnerable = true;
          result.evidence = sig;
          result.severity = "critical";
          return result;
        }
      }

      // Also check for NXDOMAIN on CNAME target (dangling)
      const { stdout: cnameResolve } = await execFileNoThrow("dig", ["+short", cname, "A"], { timeoutMs: 5000 });
      if (!cnameResolve.trim() || cnameResolve.includes("NXDOMAIN")) {
        result.vulnerable = true;
        result.evidence = `CNAME target ${cname} does not resolve (NXDOMAIN)`;
        result.severity = "high";
        return result;
      }
    } catch {
      // Connection refused / timeout could indicate unclaimed
      const { stdout: cnameResolve } = await execFileNoThrow("dig", ["+short", cname, "A"], { timeoutMs: 5000 });
      if (!cnameResolve.trim()) {
        result.vulnerable = true;
        result.evidence = `CNAME target ${cname} unreachable and does not resolve`;
        result.severity = "high";
        return result;
      }
    }

    break;
  }

  return result;
}

// ── Batch check subdomains for takeover ─────────────────

export async function checkTakeoverBatch(
  subdomains: string[],
  concurrency = 5
): Promise<{ results: TakeoverResult[]; vulnerable: TakeoverResult[] }> {
  const results: TakeoverResult[] = [];

  for (let i = 0; i < subdomains.length; i += concurrency) {
    const batch = subdomains.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(checkTakeover));
    results.push(...batchResults);
  }

  return {
    results,
    vulnerable: results.filter(r => r.vulnerable),
  };
}
