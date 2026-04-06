/**
 * WAF/CDN Detection — identify web application firewalls and CDN providers
 * Fingerprints from HTTP headers, cookies, response body patterns
 */

export interface WafDetectResult {
  url: string;
  waf: WafMatch[];
  cdn: CdnMatch[];
  loadBalancer?: string;
  reverseProxy?: string;
  timestamp: string;
}

export interface WafMatch {
  name: string;
  confidence: number;
  evidence: string[];
}

export interface CdnMatch {
  name: string;
  confidence: number;
  evidence: string[];
}

interface Fingerprint {
  name: string;
  type: "waf" | "cdn";
  headers?: Record<string, RegExp>;
  cookies?: RegExp[];
  bodyPatterns?: RegExp[];
  serverHeader?: RegExp;
}

const FINGERPRINTS: Fingerprint[] = [
  // WAFs
  { name: "Cloudflare WAF", type: "waf", headers: { "cf-ray": /./, "cf-cache-status": /./ }, serverHeader: /cloudflare/i, cookies: [/__cfduid/i, /cf_clearance/i] },
  { name: "AWS WAF", type: "waf", headers: { "x-amzn-requestid": /./, "x-amz-cf-id": /./ }, bodyPatterns: [/aws/i] },
  { name: "Akamai", type: "waf", headers: { "x-akamai-transformed": /./ }, serverHeader: /akamai/i },
  { name: "Imperva/Incapsula", type: "waf", headers: { "x-iinfo": /./, "x-cdn": /incapsula/i }, cookies: [/incap_ses/i, /visid_incap/i] },
  { name: "Sucuri", type: "waf", headers: { "x-sucuri-id": /./, "x-sucuri-cache": /./ }, serverHeader: /sucuri/i },
  { name: "F5 BIG-IP", type: "waf", cookies: [/BIGipServer/i], headers: { "x-wa-info": /./ } },
  { name: "ModSecurity", type: "waf", serverHeader: /mod_security|modsecurity/i, headers: { "x-modsecurity": /./ } },
  { name: "Barracuda", type: "waf", cookies: [/barra_counter_session/i], headers: { "barra_counter_session": /./ } },
  { name: "Fortinet/FortiWeb", type: "waf", cookies: [/FORTIWAFSID/i] },
  { name: "DenyAll", type: "waf", cookies: [/sessioncookie/i], headers: { "x-backside-transport": /./ } },
  { name: "Wallarm", type: "waf", headers: { "x-wallarm-waf-check": /./ } },
  { name: "Reblaze", type: "waf", cookies: [/rbzid/i], headers: { "x-reblaze-protection": /./ } },
  { name: "StackPath", type: "waf", headers: { "x-sp-waf": /./ } },
  { name: "Wordfence", type: "waf", bodyPatterns: [/wordfence/i], cookies: [/wfwaf-authcookie/i] },

  // CDNs
  { name: "Cloudflare CDN", type: "cdn", headers: { "cf-ray": /./ }, serverHeader: /cloudflare/i },
  { name: "AWS CloudFront", type: "cdn", headers: { "x-amz-cf-id": /./, "x-amz-cf-pop": /./ }, serverHeader: /cloudfront/i },
  { name: "Fastly", type: "cdn", headers: { "x-served-by": /cache/i, "x-cache": /./ }, serverHeader: /fastly/i },
  { name: "Akamai CDN", type: "cdn", headers: { "x-akamai-transformed": /./ } },
  { name: "KeyCDN", type: "cdn", headers: { "x-edge-location": /./ }, serverHeader: /keycdn/i },
  { name: "StackPath CDN", type: "cdn", headers: { "x-hw": /./ } },
  { name: "Bunny CDN", type: "cdn", headers: { "cdn-pullzone": /./, "cdn-uid": /./ }, serverHeader: /bunnycdn/i },
  { name: "Google Cloud CDN", type: "cdn", headers: { "x-goog-generation": /./ }, serverHeader: /gws|google/i },
  { name: "Azure CDN", type: "cdn", headers: { "x-ms-ref": /./ } },
  { name: "Varnish", type: "cdn", headers: { "x-varnish": /./ }, serverHeader: /varnish/i },
  { name: "Nginx", type: "cdn", serverHeader: /nginx/i },
  { name: "LiteSpeed", type: "cdn", serverHeader: /litespeed/i },
  { name: "Vercel Edge", type: "cdn", headers: { "x-vercel-id": /./ }, serverHeader: /vercel/i },
  { name: "Netlify CDN", type: "cdn", headers: { "x-nf-request-id": /./ }, serverHeader: /netlify/i },
];

// ── Detect WAF/CDN ──────────────────────────────────────

export async function detectWaf(url: string): Promise<WafDetectResult> {
  const targetUrl = url.startsWith("http") ? url : `https://${url}`;
  const result: WafDetectResult = { url: targetUrl, waf: [], cdn: [], timestamp: new Date().toISOString() };

  let headers: Record<string, string> = {};
  let cookies: string[] = [];
  let body = "";
  let serverHeader = "";

  // Normal request
  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WAF-Detect/1.0)" },
    });

    for (const [key, value] of response.headers.entries()) {
      headers[key.toLowerCase()] = value;
      if (key.toLowerCase() === "server") serverHeader = value;
      if (key.toLowerCase() === "set-cookie") cookies.push(value);
    }

    body = (await response.text()).slice(0, 50000);
  } catch {}

  // Also try a "malicious" request to trigger WAF response
  try {
    const wafTrigger = await fetch(`${targetUrl}/?id=1'+OR+1=1--`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WAF-Detect/1.0)" },
    });

    const wafBody = (await wafTrigger.text()).slice(0, 10000);
    body += wafBody;

    for (const [key, value] of wafTrigger.headers.entries()) {
      if (!headers[key.toLowerCase()]) headers[key.toLowerCase()] = value;
    }
  } catch {}

  // Match fingerprints
  for (const fp of FINGERPRINTS) {
    const evidence: string[] = [];
    let score = 0;

    // Check server header
    if (fp.serverHeader && fp.serverHeader.test(serverHeader)) {
      evidence.push(`Server: ${serverHeader}`);
      score += 40;
    }

    // Check headers
    if (fp.headers) {
      for (const [header, pattern] of Object.entries(fp.headers)) {
        const val = headers[header];
        if (val && pattern.test(val)) {
          evidence.push(`Header ${header}: ${val.slice(0, 50)}`);
          score += 30;
        }
      }
    }

    // Check cookies
    if (fp.cookies) {
      for (const cookiePattern of fp.cookies) {
        for (const cookie of cookies) {
          if (cookiePattern.test(cookie)) {
            evidence.push(`Cookie: ${cookie.split("=")[0]}`);
            score += 25;
          }
        }
      }
    }

    // Check body patterns
    if (fp.bodyPatterns) {
      for (const pattern of fp.bodyPatterns) {
        if (pattern.test(body)) {
          evidence.push(`Body pattern: ${pattern.source.slice(0, 30)}`);
          score += 20;
        }
      }
    }

    if (evidence.length > 0) {
      const match: WafMatch | CdnMatch = {
        name: fp.name,
        confidence: Math.min(1, score / 100),
        evidence,
      };

      if (fp.type === "waf") result.waf.push(match);
      else result.cdn.push(match);
    }
  }

  // Detect reverse proxy / load balancer from headers
  if (headers["via"]) result.reverseProxy = headers["via"];
  if (headers["x-forwarded-for"] || headers["x-real-ip"]) result.loadBalancer = "Detected (X-Forwarded-For present)";

  // Sort by confidence
  result.waf.sort((a, b) => b.confidence - a.confidence);
  result.cdn.sort((a, b) => b.confidence - a.confidence);

  return result;
}
