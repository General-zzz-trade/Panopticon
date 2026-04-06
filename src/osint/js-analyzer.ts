/**
 * JavaScript Analyzer — extract secrets, API endpoints, internal URLs from JS files
 * Discovers hidden attack surface from client-side code
 */

export interface JsAnalysisResult {
  url: string;
  jsFiles: JsFileResult[];
  allSecrets: SecretFinding[];
  allEndpoints: string[];
  allInternalUrls: string[];
  stats: {
    filesAnalyzed: number;
    secretsFound: number;
    endpointsFound: number;
    internalUrlsFound: number;
  };
  timestamp: string;
}

export interface JsFileResult {
  url: string;
  size: number;
  secrets: SecretFinding[];
  endpoints: string[];
  internalUrls: string[];
  domainRefs: string[];
}

export interface SecretFinding {
  type: string;
  value: string;
  context: string;
  file: string;
  severity: "critical" | "high" | "medium" | "low";
}

// ── Secret Patterns ─────────────────────────────────────

const JS_SECRET_PATTERNS: { name: string; regex: RegExp; severity: SecretFinding["severity"] }[] = [
  { name: "AWS Access Key", regex: /(?:AKIA|ASIA)[0-9A-Z]{16}/g, severity: "critical" },
  { name: "AWS Secret", regex: /(?:aws_secret_access_key|secret_key)\s*[:=]\s*['"]([A-Za-z0-9/+=]{40})['"]/gi, severity: "critical" },
  { name: "Google API Key", regex: /AIza[0-9A-Za-z\-_]{35}/g, severity: "high" },
  { name: "Google OAuth", regex: /[0-9]+-[0-9A-Za-z_]{32}\.apps\.googleusercontent\.com/g, severity: "medium" },
  { name: "Firebase Key", regex: /(?:firebase|FIREBASE).*?['"]([A-Za-z0-9_-]{30,})['"]/g, severity: "high" },
  { name: "Stripe Key", regex: /(?:pk|sk)_(?:test|live)_[0-9a-zA-Z]{24,}/g, severity: "critical" },
  { name: "JWT Token", regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, severity: "high" },
  { name: "Private Key", regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g, severity: "critical" },
  { name: "Slack Token", regex: /xox[bpors]-[0-9]{10,}-[A-Za-z0-9-]{20,}/g, severity: "high" },
  { name: "GitHub Token", regex: /gh[ps]_[A-Za-z0-9_]{36,}/g, severity: "critical" },
  { name: "Twilio", regex: /(?:AC|SK)[a-f0-9]{32}/g, severity: "high" },
  { name: "SendGrid", regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g, severity: "high" },
  { name: "Mailgun", regex: /key-[0-9a-zA-Z]{32}/g, severity: "high" },
  { name: "Database URL", regex: /(?:mongodb|postgres|mysql|redis|amqp):\/\/[^\s'"<>]{10,}/g, severity: "critical" },
  { name: "Bearer Token", regex: /[Bb]earer\s+[A-Za-z0-9_\-.]{20,}/g, severity: "high" },
  { name: "Basic Auth", regex: /[Bb]asic\s+[A-Za-z0-9+/=]{20,}/g, severity: "high" },
  { name: "Hardcoded Password", regex: /(?:password|passwd|pwd|secret)\s*[:=]\s*['"]([^'"]{6,})['"]/gi, severity: "medium" },
  { name: "API Key Generic", regex: /(?:api_key|apikey|api-key|apiKey)\s*[:=]\s*['"]([^'"]{16,})['"]/gi, severity: "medium" },
  { name: "Mapbox Token", regex: /pk\.eyJ[A-Za-z0-9_-]{40,}/g, severity: "medium" },
  { name: "Algolia Key", regex: /[a-f0-9]{32}/g, severity: "low" }, // Too generic, low priority
];

// ── API Endpoint Patterns ───────────────────────────────

const ENDPOINT_PATTERNS: RegExp[] = [
  /['"`]\/api\/v?\d*\/[a-zA-Z0-9/_-]+['"`]/g,
  /['"`]\/v\d+\/[a-zA-Z0-9/_-]+['"`]/g,
  /fetch\s*\(\s*['"`]([^'"` ]+)['"`]/g,
  /axios\.\w+\s*\(\s*['"`]([^'"` ]+)['"`]/g,
  /\.(?:get|post|put|patch|delete)\s*\(\s*['"`]([^'"` ]+)['"`]/g,
  /(?:url|endpoint|path|route)\s*[:=]\s*['"`](\/[a-zA-Z0-9/_-]+)['"`]/gi,
  /['"`](https?:\/\/[^'"` ]+\/api[^'"` ]*)['"`]/g,
];

// ── Internal URL Patterns ───────────────────────────────

const INTERNAL_URL_PATTERNS: RegExp[] = [
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)[:\d]*/g,
  /(?:staging|dev|test|internal|admin|debug|preprod|uat)[.-][a-zA-Z0-9.-]+\.[a-z]{2,}/gi,
  /['"`]((?:https?:)?\/\/[a-z0-9.-]+\.(?:internal|local|corp|intranet|lan)[^'"` ]*)['"`]/gi,
];

// ── Discover JS Files from HTML ─────────────────────────

async function discoverJsFiles(url: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JSAnalyzer/1.0)" },
    });
    const html = await response.text();

    // <script src="...">
    const scriptMatches = html.matchAll(/<script[^>]*src=["']([^"']+)["']/gi);
    for (const match of scriptMatches) {
      try {
        const resolved = new URL(match[1], url).href;
        if (resolved.endsWith(".js") || resolved.includes(".js?")) {
          files.push(resolved);
        }
      } catch {}
    }

    // Inline webpack/vite chunk references
    const chunkMatches = html.matchAll(/["']((?:\/|https?:\/\/)[^"']*\.(?:js|mjs|chunk\.js)[^"']*)["']/g);
    for (const match of chunkMatches) {
      try {
        const resolved = new URL(match[1], url).href;
        if (!files.includes(resolved)) files.push(resolved);
      } catch {}
    }
  } catch {}

  return files.slice(0, 30); // Limit to 30 JS files
}

// ── Analyze Single JS File ──────────────────────────────

async function analyzeJsFile(jsUrl: string): Promise<JsFileResult> {
  const result: JsFileResult = {
    url: jsUrl,
    size: 0,
    secrets: [],
    endpoints: [],
    internalUrls: [],
    domainRefs: [],
  };

  try {
    const response = await fetch(jsUrl, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JSAnalyzer/1.0)" },
    });
    const code = await response.text();
    result.size = code.length;

    // Find secrets
    for (const { name, regex, severity } of JS_SECRET_PATTERNS) {
      // Reset regex lastIndex
      regex.lastIndex = 0;
      const matches = code.matchAll(new RegExp(regex.source, regex.flags));
      for (const match of matches) {
        const value = match[1] || match[0];
        // Skip very common false positives
        if (value.length < 8 || /^[0]+$|^[x]+$/i.test(value)) continue;
        // Get surrounding context
        const idx = match.index || 0;
        const context = code.slice(Math.max(0, idx - 30), Math.min(code.length, idx + value.length + 30));

        result.secrets.push({
          type: name,
          value: value.slice(0, 60) + (value.length > 60 ? "..." : ""),
          context: context.replace(/\n/g, " ").slice(0, 100),
          file: jsUrl,
          severity,
        });
      }
    }

    // Find API endpoints
    for (const pattern of ENDPOINT_PATTERNS) {
      const matches = code.matchAll(new RegExp(pattern.source, pattern.flags));
      for (const match of matches) {
        const ep = (match[1] || match[0]).replace(/['"` ]/g, "");
        if (ep.length > 3 && !result.endpoints.includes(ep)) {
          result.endpoints.push(ep);
        }
      }
    }

    // Find internal URLs
    for (const pattern of INTERNAL_URL_PATTERNS) {
      const matches = code.matchAll(new RegExp(pattern.source, pattern.flags));
      for (const match of matches) {
        const url = (match[1] || match[0]).replace(/['"` ]/g, "");
        if (!result.internalUrls.includes(url)) {
          result.internalUrls.push(url);
        }
      }
    }

    // Find domain references
    const domainMatches = code.matchAll(/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|dev|app)\b/gi);
    for (const match of domainMatches) {
      if (!result.domainRefs.includes(match[0]) && result.domainRefs.length < 50) {
        result.domainRefs.push(match[0]);
      }
    }
  } catch {}

  // Deduplicate
  result.endpoints = [...new Set(result.endpoints)].slice(0, 100);
  result.internalUrls = [...new Set(result.internalUrls)].slice(0, 50);
  result.domainRefs = [...new Set(result.domainRefs)].slice(0, 50);

  return result;
}

// ── Full JS Analysis ────────────────────────────────────

export async function analyzeJavaScript(url: string): Promise<JsAnalysisResult> {
  const targetUrl = url.startsWith("http") ? url : `https://${url}`;
  const jsFiles = await discoverJsFiles(targetUrl);

  const results: JsFileResult[] = [];
  for (const jsUrl of jsFiles) {
    const result = await analyzeJsFile(jsUrl);
    if (result.secrets.length > 0 || result.endpoints.length > 0 || result.internalUrls.length > 0) {
      results.push(result);
    }
  }

  const allSecrets = results.flatMap(r => r.secrets);
  const allEndpoints = [...new Set(results.flatMap(r => r.endpoints))];
  const allInternalUrls = [...new Set(results.flatMap(r => r.internalUrls))];

  return {
    url: targetUrl,
    jsFiles: results,
    allSecrets,
    allEndpoints,
    allInternalUrls,
    stats: {
      filesAnalyzed: jsFiles.length,
      secretsFound: allSecrets.length,
      endpointsFound: allEndpoints.length,
      internalUrlsFound: allInternalUrls.length,
    },
    timestamp: new Date().toISOString(),
  };
}
