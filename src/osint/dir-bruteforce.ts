/**
 * Directory Bruteforce + CORS Misconfiguration + HTTP Parameter Discovery
 * Pure HTTP probing — no external APIs needed
 */

// ── Directory Bruteforce ────────────────────────────────

export interface DirBruteResult {
  target: string;
  found: DirEntry[];
  stats: { checked: number; found: number; durationMs: number };
  timestamp: string;
}

export interface DirEntry {
  path: string;
  url: string;
  status: number;
  contentType?: string;
  size?: number;
  redirect?: string;
  severity: "critical" | "high" | "medium" | "info";
}

const DIR_WORDLIST: { path: string; severity: DirEntry["severity"]; description?: string }[] = [
  // Sensitive files (critical)
  { path: "/.env", severity: "critical" }, { path: "/.env.local", severity: "critical" },
  { path: "/.env.production", severity: "critical" }, { path: "/.env.backup", severity: "critical" },
  { path: "/.git/config", severity: "critical" }, { path: "/.git/HEAD", severity: "critical" },
  { path: "/.svn/entries", severity: "critical" }, { path: "/.svn/wc.db", severity: "critical" },
  { path: "/.DS_Store", severity: "high" }, { path: "/Thumbs.db", severity: "info" },
  { path: "/web.config", severity: "high" }, { path: "/crossdomain.xml", severity: "medium" },
  { path: "/.htaccess", severity: "high" }, { path: "/.htpasswd", severity: "critical" },
  { path: "/wp-config.php.bak", severity: "critical" }, { path: "/wp-config.old", severity: "critical" },
  { path: "/config.php.bak", severity: "critical" }, { path: "/database.yml", severity: "critical" },

  // Admin panels (high)
  { path: "/admin", severity: "high" }, { path: "/admin/", severity: "high" },
  { path: "/administrator", severity: "high" }, { path: "/wp-admin", severity: "high" },
  { path: "/cpanel", severity: "high" }, { path: "/phpmyadmin", severity: "high" },
  { path: "/adminer.php", severity: "high" }, { path: "/admin.php", severity: "high" },
  { path: "/manager", severity: "high" }, { path: "/dashboard", severity: "medium" },
  { path: "/console", severity: "high" }, { path: "/webadmin", severity: "high" },

  // Backup files
  { path: "/backup", severity: "high" }, { path: "/backup.sql", severity: "critical" },
  { path: "/backup.zip", severity: "critical" }, { path: "/backup.tar.gz", severity: "critical" },
  { path: "/db.sql", severity: "critical" }, { path: "/dump.sql", severity: "critical" },
  { path: "/database.sql", severity: "critical" }, { path: "/site.tar.gz", severity: "critical" },

  // Debug / Info disclosure
  { path: "/debug", severity: "high" }, { path: "/debug/vars", severity: "high" },
  { path: "/debug/pprof", severity: "high" }, { path: "/phpinfo.php", severity: "high" },
  { path: "/info.php", severity: "high" }, { path: "/server-status", severity: "high" },
  { path: "/server-info", severity: "high" }, { path: "/elmah.axd", severity: "high" },
  { path: "/trace.axd", severity: "high" },

  // Spring Boot Actuator
  { path: "/actuator", severity: "high" }, { path: "/actuator/env", severity: "critical" },
  { path: "/actuator/health", severity: "info" }, { path: "/actuator/info", severity: "medium" },
  { path: "/actuator/configprops", severity: "critical" }, { path: "/actuator/heapdump", severity: "critical" },
  { path: "/actuator/mappings", severity: "high" }, { path: "/actuator/beans", severity: "medium" },

  // API docs
  { path: "/swagger.json", severity: "medium" }, { path: "/swagger-ui.html", severity: "medium" },
  { path: "/swagger/v1/swagger.json", severity: "medium" },
  { path: "/api-docs", severity: "medium" }, { path: "/openapi.json", severity: "medium" },
  { path: "/graphql", severity: "medium" }, { path: "/graphiql", severity: "medium" },

  // Common CMS paths
  { path: "/wp-login.php", severity: "info" }, { path: "/wp-json", severity: "info" },
  { path: "/wp-content/debug.log", severity: "critical" },
  { path: "/xmlrpc.php", severity: "medium" },
  { path: "/readme.html", severity: "info" }, { path: "/license.txt", severity: "info" },
  { path: "/CHANGELOG.md", severity: "info" }, { path: "/CHANGELOG.txt", severity: "info" },
  { path: "/package.json", severity: "medium" }, { path: "/composer.json", severity: "medium" },

  // Well-known
  { path: "/.well-known/security.txt", severity: "info" },
  { path: "/.well-known/openid-configuration", severity: "info" },
  { path: "/robots.txt", severity: "info" }, { path: "/sitemap.xml", severity: "info" },
  { path: "/humans.txt", severity: "info" }, { path: "/favicon.ico", severity: "info" },
];

export async function dirBruteforce(
  url: string,
  options: { concurrency?: number; customPaths?: string[] } = {}
): Promise<DirBruteResult> {
  const baseUrl = (url.startsWith("http") ? url : `https://${url}`).replace(/\/+$/, "");
  const concurrency = options.concurrency || 10;
  const paths = options.customPaths
    ? options.customPaths.map(p => ({ path: p, severity: "medium" as const }))
    : DIR_WORDLIST;

  const found: DirEntry[] = [];
  const start = Date.now();

  // First get a 404 baseline to filter false positives
  let baseline404Size = 0;
  try {
    const r = await fetch(`${baseUrl}/osint-nonexistent-path-${Date.now()}`, {
      signal: AbortSignal.timeout(5000), method: "GET",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (r.status === 200) {
      baseline404Size = (await r.text()).length;
    }
  } catch {}

  for (let i = 0; i < paths.length; i += concurrency) {
    const batch = paths.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (entry) => {
        try {
          const response = await fetch(`${baseUrl}${entry.path}`, {
            method: "GET", redirect: "manual",
            signal: AbortSignal.timeout(5000),
            headers: { "User-Agent": "Mozilla/5.0 (compatible; DirScan/1.0)" },
          });

          // Skip generic 404 pages that return 200
          if (response.status === 200 && baseline404Size > 0) {
            const body = await response.text();
            if (Math.abs(body.length - baseline404Size) < 100) return; // Same as 404 page
          }

          if (response.status !== 404 && response.status !== 0) {
            const redirect = response.headers.get("location") || undefined;
            found.push({
              path: entry.path,
              url: `${baseUrl}${entry.path}`,
              status: response.status,
              contentType: response.headers.get("content-type")?.split(";")[0],
              redirect,
              severity: response.status === 200 ? entry.severity : "info",
            });
          }
        } catch {}
      })
    );
  }

  return {
    target: baseUrl,
    found: found.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, info: 3 };
      return (order[a.severity] || 4) - (order[b.severity] || 4);
    }),
    stats: { checked: paths.length, found: found.length, durationMs: Date.now() - start },
    timestamp: new Date().toISOString(),
  };
}

// ── CORS Misconfiguration Detection ─────────────────────

export interface CorsCheckResult {
  url: string;
  vulnerable: boolean;
  issues: CorsIssue[];
  timestamp: string;
}

export interface CorsIssue {
  type: "wildcard" | "null_origin" | "reflected" | "subdomain_wildcard" | "credentials_with_wildcard";
  description: string;
  severity: "critical" | "high" | "medium";
  evidence: string;
}

export async function checkCors(url: string): Promise<CorsCheckResult> {
  const targetUrl = url.startsWith("http") ? url : `https://${url}`;
  const issues: CorsIssue[] = [];

  const origins = [
    { origin: "https://evil.com", type: "reflected" as const },
    { origin: "null", type: "null_origin" as const },
    { origin: `https://sub.${new URL(targetUrl).hostname}`, type: "subdomain_wildcard" as const },
    { origin: "https://evil" + new URL(targetUrl).hostname, type: "reflected" as const },
  ];

  for (const test of origins) {
    try {
      const response = await fetch(targetUrl, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
        headers: {
          "Origin": test.origin,
          "User-Agent": "Mozilla/5.0",
        },
      });

      const acao = response.headers.get("access-control-allow-origin");
      const acac = response.headers.get("access-control-allow-credentials");

      if (!acao) continue;

      // Wildcard with credentials
      if (acao === "*" && acac === "true") {
        issues.push({
          type: "credentials_with_wildcard",
          description: "CORS allows credentials with wildcard origin — can steal authenticated data",
          severity: "critical",
          evidence: `ACAO: *, ACAC: true`,
        });
      }

      // Reflected origin
      if (acao === test.origin && test.type === "reflected") {
        issues.push({
          type: "reflected",
          description: `Origin ${test.origin} is reflected back — attacker can read responses`,
          severity: acac === "true" ? "critical" : "high",
          evidence: `Origin: ${test.origin} → ACAO: ${acao}`,
        });
      }

      // Null origin accepted
      if (test.origin === "null" && acao === "null") {
        issues.push({
          type: "null_origin",
          description: "Null origin accepted — can be exploited via sandboxed iframes",
          severity: "high",
          evidence: `Origin: null → ACAO: null`,
        });
      }

      // Wildcard
      if (acao === "*" && !issues.some(i => i.type === "credentials_with_wildcard")) {
        issues.push({
          type: "wildcard",
          description: "CORS allows any origin (wildcard)",
          severity: "medium",
          evidence: `ACAO: *`,
        });
        break; // No need to test more
      }
    } catch {}
  }

  return {
    url: targetUrl,
    vulnerable: issues.length > 0,
    issues,
    timestamp: new Date().toISOString(),
  };
}

// ── HTTP Parameter Discovery ────────────────────────────

export interface ParamDiscoveryResult {
  url: string;
  params: DiscoveredParam[];
  stats: { checked: number; found: number };
  timestamp: string;
}

export interface DiscoveredParam {
  name: string;
  method: "GET" | "POST";
  reflected: boolean;
  changesResponse: boolean;
  evidence: string;
}

const COMMON_PARAMS = [
  "id", "page", "p", "q", "query", "search", "s", "keyword",
  "url", "redirect", "return", "next", "goto", "target", "rurl", "dest",
  "file", "path", "dir", "folder", "document", "template", "include",
  "action", "cmd", "command", "exec", "func", "function", "callback",
  "user", "username", "email", "name", "login", "password",
  "token", "key", "api_key", "apikey", "secret", "auth",
  "debug", "test", "admin", "verbose", "trace",
  "format", "type", "output", "lang", "language", "locale",
  "sort", "order", "limit", "offset", "count", "size",
  "category", "cat", "tag", "filter", "status", "state",
  "version", "v", "ref", "source", "utm_source", "utm_campaign",
];

export async function discoverParams(url: string): Promise<ParamDiscoveryResult> {
  const targetUrl = (url.startsWith("http") ? url : `https://${url}`).split("?")[0];
  const found: DiscoveredParam[] = [];

  // Get baseline response
  let baselineBody = "";
  let baselineLength = 0;
  try {
    const response = await fetch(targetUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    baselineBody = await response.text();
    baselineLength = baselineBody.length;
  } catch { return { url: targetUrl, params: [], stats: { checked: 0, found: 0 }, timestamp: new Date().toISOString() }; }

  // Test each parameter
  const testValue = "panopticon_test_123";
  for (const param of COMMON_PARAMS) {
    try {
      const testUrl = `${targetUrl}?${param}=${testValue}`;
      const response = await fetch(testUrl, {
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const body = await response.text();

      const reflected = body.includes(testValue);
      const changesResponse = Math.abs(body.length - baselineLength) > 50;

      if (reflected || changesResponse) {
        found.push({
          name: param,
          method: "GET",
          reflected,
          changesResponse,
          evidence: reflected ? "Value reflected in response" : `Response size changed by ${Math.abs(body.length - baselineLength)} bytes`,
        });
      }
    } catch {}
  }

  return {
    url: targetUrl,
    params: found,
    stats: { checked: COMMON_PARAMS.length, found: found.length },
    timestamp: new Date().toISOString(),
  };
}
