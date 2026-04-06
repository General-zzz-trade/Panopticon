/**
 * Google Dork Executor — automated search engine reconnaissance
 * Uses DuckDuckGo HTML (no API key, no captcha) + Bing as fallback
 */

export interface DorkResult {
  query: string;
  engine: string;
  results: SearchResult[];
  totalResults: number;
  timestamp: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ── DuckDuckGo HTML Search (free, no key) ───────────────

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  try {
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html",
        },
      }
    );

    if (!response.ok) return results;
    const html = await response.text();

    // Parse DuckDuckGo HTML results
    const resultBlocks = html.matchAll(/<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi);

    for (const block of resultBlocks) {
      const content = block[1];

      const urlMatch = content.match(/href="([^"]+)"/);
      const titleMatch = content.match(/<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/);
      const snippetMatch = content.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

      if (urlMatch) {
        // DuckDuckGo uses redirect URLs, extract actual URL
        let url = urlMatch[1];
        const uddgMatch = url.match(/uddg=([^&]+)/);
        if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);

        results.push({
          title: (titleMatch?.[1] || "").replace(/<[^>]+>/g, "").trim(),
          url,
          snippet: (snippetMatch?.[1] || "").replace(/<[^>]+>/g, "").trim(),
        });
      }
    }
  } catch {}

  return results;
}

// ── Bing Search (free, no key for basic) ────────────────

async function searchBing(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  try {
    const response = await fetch(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=20`,
      {
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html",
        },
      }
    );

    if (!response.ok) return results;
    const html = await response.text();

    const matches = html.matchAll(/<li class="b_algo">([\s\S]*?)<\/li>/gi);

    for (const match of matches) {
      const block = match[1];
      const urlMatch = block.match(/<a\s+href="(https?:\/\/[^"]+)"/);
      const titleMatch = block.match(/<a[^>]*>([\s\S]*?)<\/a>/);
      const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);

      if (urlMatch) {
        results.push({
          title: (titleMatch?.[1] || "").replace(/<[^>]+>/g, "").trim(),
          url: urlMatch[1],
          snippet: (snippetMatch?.[1] || "").replace(/<[^>]+>/g, "").trim(),
        });
      }
    }
  } catch {}

  return results;
}

// ── Execute Single Dork ─────────────────────────────────

export async function executeDork(query: string): Promise<DorkResult> {
  // Try DuckDuckGo first, fall back to Bing
  let results = await searchDuckDuckGo(query);
  let engine = "duckduckgo";

  if (results.length === 0) {
    results = await searchBing(query);
    engine = "bing";
  }

  return {
    query,
    engine,
    results,
    totalResults: results.length,
    timestamp: new Date().toISOString(),
  };
}

// ── Execute All Dorks for Domain ────────────────────────

export interface DorkSuiteResult {
  domain: string;
  dorks: { name: string; query: string; result: DorkResult }[];
  totalFindings: number;
  interestingUrls: string[];
  timestamp: string;
}

const DORK_TEMPLATES: Record<string, string> = {
  subdomains: "site:{domain} -www",
  login_pages: 'site:{domain} inurl:login OR inurl:signin OR inurl:admin',
  exposed_files: "site:{domain} filetype:pdf OR filetype:doc OR filetype:xls",
  config_files: 'site:{domain} filetype:env OR filetype:yml OR filetype:conf "password"',
  api_endpoints: "site:{domain} inurl:api OR inurl:swagger OR inurl:graphql",
  error_pages: 'site:{domain} "error" OR "stack trace" OR "exception"',
  directory_listing: 'site:{domain} intitle:"index of"',
  sensitive_dirs: 'site:{domain} inurl:backup OR inurl:admin OR inurl:debug',
  email_harvesting: 'site:{domain} "@{domain}"',
  social_profiles: '"{domain}" site:linkedin.com OR site:github.com',
  paste_sites: '"{domain}" site:pastebin.com OR site:gist.github.com',
  cloud_storage: '"{domain}" site:s3.amazonaws.com OR site:storage.googleapis.com',
};

export async function executeDorkSuite(domain: string): Promise<DorkSuiteResult> {
  const dorks: DorkSuiteResult["dorks"] = [];
  const interestingUrls: string[] = [];

  for (const [name, template] of Object.entries(DORK_TEMPLATES)) {
    const query = template.replace(/\{domain\}/g, domain);

    // Rate limit: 3 second delay between searches
    await new Promise(r => setTimeout(r, 3000));

    const result = await executeDork(query);
    dorks.push({ name, query, result });

    // Collect interesting URLs
    for (const r of result.results) {
      if (r.url && !r.url.includes("google") && !r.url.includes("bing") && !r.url.includes("duckduckgo")) {
        interestingUrls.push(r.url);
      }
    }
  }

  return {
    domain,
    dorks,
    totalFindings: dorks.reduce((sum, d) => sum + d.result.totalResults, 0),
    interestingUrls: [...new Set(interestingUrls)],
    timestamp: new Date().toISOString(),
  };
}
