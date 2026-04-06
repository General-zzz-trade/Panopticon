/**
 * API Endpoint Discovery — find hidden APIs from JS, robots.txt, sitemap, common paths
 */

export interface ApiDiscoveryResult {
  target: string;
  endpoints: DiscoveredEndpoint[];
  apiDocs: { url: string; type: string }[];
  stats: { total: number; responsive: number; authenticated: number };
  timestamp: string;
}

export interface DiscoveredEndpoint {
  url: string;
  method: string;
  status?: number;
  source: string;  // where it was found
  authenticated: boolean; // returns 401/403?
  contentType?: string;
}

// ── Common API Paths to Probe ───────────────────────────

const COMMON_API_PATHS = [
  // Documentation
  "/swagger.json", "/swagger/v1/swagger.json", "/api-docs", "/api/docs",
  "/openapi.json", "/openapi.yaml", "/v1/api-docs", "/v2/api-docs", "/v3/api-docs",
  "/docs", "/redoc", "/graphql", "/graphiql", "/playground",
  // Version endpoints
  "/api", "/api/v1", "/api/v2", "/api/v3",
  "/rest", "/rest/v1", "/rest/v2",
  // Health/Status
  "/api/health", "/api/status", "/health", "/healthz", "/ready", "/ping",
  "/api/v1/health", "/api/v1/status", "/_health",
  // Auth
  "/api/auth", "/api/login", "/api/register", "/api/token", "/api/oauth",
  "/api/v1/auth/login", "/auth/login", "/login",
  // User/Profile
  "/api/users", "/api/user", "/api/me", "/api/profile",
  "/api/v1/users", "/api/v1/user/me",
  // Admin
  "/admin", "/admin/api", "/api/admin", "/dashboard",
  "/manage", "/management", "/internal",
  // Debug
  "/debug", "/debug/vars", "/debug/pprof", "/.env", "/config",
  "/server-status", "/server-info", "/info", "/phpinfo.php",
  "/actuator", "/actuator/health", "/actuator/env", "/actuator/info",
  "/.git/config", "/.svn/entries", "/wp-json", "/wp-json/wp/v2",
  // Common frameworks
  "/api/v1/version", "/version", "/metrics", "/prometheus",
  "/sitemap.xml", "/robots.txt", "/crossdomain.xml", "/.well-known/security.txt",
  "/feed", "/feed.xml", "/rss", "/atom.xml",
];

// ── Probe Endpoint ──────────────────────────────────────

async function probeEndpoint(baseUrl: string, path: string): Promise<DiscoveredEndpoint | null> {
  const url = `${baseUrl.replace(/\/+$/, "")}${path}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; API-Discovery/1.0)" },
    });

    // Skip generic 404 pages (check content-type)
    const contentType = response.headers.get("content-type") || "";
    const isApi = contentType.includes("json") || contentType.includes("xml") || contentType.includes("yaml");
    const isHtml = contentType.includes("html");

    // Interesting responses: not-404, or JSON/XML responses
    if (response.status !== 404 && (response.status !== 200 || isApi || path.includes("swagger") || path.includes("graphql"))) {
      return {
        url,
        method: "GET",
        status: response.status,
        source: "path-probe",
        authenticated: response.status === 401 || response.status === 403,
        contentType: contentType.split(";")[0],
      };
    }

    // Also check if 200 response has meaningful API content
    if (response.status === 200 && isApi) {
      return {
        url,
        method: "GET",
        status: 200,
        source: "path-probe",
        authenticated: false,
        contentType: contentType.split(";")[0],
      };
    }
  } catch {}

  return null;
}

// ── Full API Discovery ──────────────────────────────────

export async function discoverApis(
  url: string,
  options: { concurrency?: number; customPaths?: string[] } = {}
): Promise<ApiDiscoveryResult> {
  const baseUrl = url.startsWith("http") ? url : `https://${url}`;
  const concurrency = options.concurrency || 10;
  const paths = [...COMMON_API_PATHS, ...(options.customPaths || [])];

  const endpoints: DiscoveredEndpoint[] = [];
  const apiDocs: { url: string; type: string }[] = [];

  // Probe in batches
  for (let i = 0; i < paths.length; i += concurrency) {
    const batch = paths.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(p => probeEndpoint(baseUrl, p)));

    for (const ep of results) {
      if (!ep) continue;
      endpoints.push(ep);

      // Identify API documentation
      if (ep.url.includes("swagger") || ep.url.includes("openapi")) {
        apiDocs.push({ url: ep.url, type: "swagger/openapi" });
      } else if (ep.url.includes("graphql") || ep.url.includes("graphiql")) {
        apiDocs.push({ url: ep.url, type: "graphql" });
      } else if (ep.url.includes("api-docs") || ep.url.includes("redoc")) {
        apiDocs.push({ url: ep.url, type: "api-docs" });
      }
    }
  }

  return {
    target: baseUrl,
    endpoints,
    apiDocs,
    stats: {
      total: endpoints.length,
      responsive: endpoints.filter(e => e.status && e.status < 500).length,
      authenticated: endpoints.filter(e => e.authenticated).length,
    },
    timestamp: new Date().toISOString(),
  };
}
