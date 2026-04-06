/**
 * Web Intelligence — Google dorking, Wayback Machine, tech stack detection, site analysis
 * No external APIs — uses browser automation + HTTP scraping
 */

import { execFileNoThrow } from "../utils/execFileNoThrow.js";

export interface GoogleDorkResult {
  query: string;
  results: { title: string; url: string; snippet: string }[];
}

export interface WaybackSnapshot {
  timestamp: string;
  url: string;
  statusCode: number;
  mimeType: string;
}

export interface TechStackResult {
  url: string;
  server?: string;
  framework?: string;
  cms?: string;
  javascript: string[];
  css: string[];
  analytics: string[];
  cdn?: string;
  hosting?: string;
  security: string[];
  headers: Record<string, string>;
}

export interface SiteMapEntry {
  url: string;
  lastmod?: string;
  priority?: string;
}

export interface RobotsAnalysis {
  userAgents: string[];
  disallowed: string[];
  allowed: string[];
  sitemaps: string[];
  crawlDelay?: number;
}

// ── Google Dork Queries ─────────────────────────────────

const DORK_TEMPLATES: Record<string, string> = {
  subdomains: 'site:{domain} -www',
  login: 'site:{domain} inurl:login OR inurl:signin OR inurl:admin',
  files: 'site:{domain} filetype:pdf OR filetype:doc OR filetype:xls OR filetype:csv',
  exposed: 'site:{domain} inurl:config OR inurl:.env OR inurl:backup',
  apis: 'site:{domain} inurl:api OR inurl:swagger OR inurl:graphql',
  errors: 'site:{domain} "error" OR "exception" OR "stack trace" OR "debug"',
  directories: 'site:{domain} intitle:"index of"',
  passwords: 'site:{domain} intext:"password" filetype:txt OR filetype:log',
  emails: 'site:{domain} intext:"@{domain}"',
  social: '"{domain}" site:linkedin.com OR site:twitter.com OR site:github.com',
  pastebin: '"{domain}" site:pastebin.com OR site:gist.github.com OR site:ghostbin.com',
  cloud: 'site:s3.amazonaws.com OR site:blob.core.windows.net OR site:storage.googleapis.com "{domain}"',
};

export function generateDorks(domain: string): Record<string, string> {
  const dorks: Record<string, string> = {};
  for (const [name, template] of Object.entries(DORK_TEMPLATES)) {
    dorks[name] = template.replace(/\{domain\}/g, domain);
  }
  return dorks;
}

// ── Wayback Machine (web.archive.org — free) ────────────

export async function waybackSnapshots(
  url: string,
  options: { limit?: number; from?: string; to?: string } = {}
): Promise<WaybackSnapshot[]> {
  const limit = options.limit || 50;
  const snapshots: WaybackSnapshot[] = [];

  try {
    // CDX API — completely free, no key
    let cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&limit=${limit}&fl=timestamp,original,statuscode,mimetype`;
    if (options.from) cdxUrl += `&from=${options.from}`;
    if (options.to) cdxUrl += `&to=${options.to}`;

    const response = await fetch(cdxUrl, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) return snapshots;

    const data: string[][] = await response.json();
    // First row is headers
    for (let i = 1; i < data.length; i++) {
      const [timestamp, original, statusCode, mimeType] = data[i];
      snapshots.push({
        timestamp,
        url: `https://web.archive.org/web/${timestamp}/${original}`,
        statusCode: parseInt(statusCode, 10),
        mimeType,
      });
    }
  } catch {}

  return snapshots;
}

export async function waybackDiff(url: string): Promise<{
  firstSeen?: string;
  lastSeen?: string;
  totalSnapshots: number;
  snapshots: WaybackSnapshot[];
}> {
  const snapshots = await waybackSnapshots(url, { limit: 200 });

  return {
    firstSeen: snapshots[0]?.timestamp,
    lastSeen: snapshots[snapshots.length - 1]?.timestamp,
    totalSnapshots: snapshots.length,
    snapshots,
  };
}

// ── Technology Stack Detection (from HTML + headers) ────

const TECH_SIGNATURES: Record<string, { pattern: RegExp; category: string }> = {
  // JavaScript Frameworks
  "React": { pattern: /react(?:\.production|dom|\.min)?\.js|__NEXT_DATA__|_next\/static/i, category: "javascript" },
  "Vue.js": { pattern: /vue(?:\.min|\.runtime)?\.js|__VUE_|v-app/i, category: "javascript" },
  "Angular": { pattern: /angular(?:\.min)?\.js|ng-app|ng-controller|angular\.module/i, category: "javascript" },
  "Svelte": { pattern: /svelte(?:\.min)?\.js|__svelte/i, category: "javascript" },
  "jQuery": { pattern: /jquery(?:\.min)?\.js/i, category: "javascript" },
  "Next.js": { pattern: /_next\/|__NEXT_DATA__/i, category: "javascript" },
  "Nuxt": { pattern: /_nuxt\/|__NUXT__/i, category: "javascript" },
  "Remix": { pattern: /remix|__remix/i, category: "javascript" },

  // CSS
  "Tailwind CSS": { pattern: /tailwindcss|tailwind\.min\.css/i, category: "css" },
  "Bootstrap": { pattern: /bootstrap(?:\.min)?\.(?:css|js)/i, category: "css" },
  "Bulma": { pattern: /bulma(?:\.min)?\.css/i, category: "css" },

  // CMS
  "WordPress": { pattern: /wp-content|wp-includes|wordpress/i, category: "cms" },
  "Drupal": { pattern: /\/sites\/default\/files|drupal\.js/i, category: "cms" },
  "Joomla": { pattern: /\/media\/jui\/|joomla/i, category: "cms" },
  "Ghost": { pattern: /ghost\.io|\/ghost\//i, category: "cms" },
  "Hugo": { pattern: /hugo-|powered by Hugo/i, category: "cms" },
  "Jekyll": { pattern: /jekyll|Powered by Jekyll/i, category: "cms" },

  // Analytics
  "Google Analytics": { pattern: /google-analytics\.com|gtag|googletagmanager/i, category: "analytics" },
  "Matomo": { pattern: /matomo|piwik/i, category: "analytics" },
  "Plausible": { pattern: /plausible\.io/i, category: "analytics" },
  "Umami": { pattern: /umami/i, category: "analytics" },
  "Mixpanel": { pattern: /mixpanel/i, category: "analytics" },
  "Hotjar": { pattern: /hotjar/i, category: "analytics" },
  "Segment": { pattern: /segment\.com|analytics\.js/i, category: "analytics" },

  // CDN
  "Cloudflare": { pattern: /cloudflare|cf-ray/i, category: "cdn" },
  "Fastly": { pattern: /fastly/i, category: "cdn" },
  "Akamai": { pattern: /akamai/i, category: "cdn" },
  "AWS CloudFront": { pattern: /cloudfront\.net/i, category: "cdn" },

  // Security
  "reCAPTCHA": { pattern: /recaptcha/i, category: "security" },
  "hCaptcha": { pattern: /hcaptcha/i, category: "security" },
  "Cloudflare Turnstile": { pattern: /turnstile/i, category: "security" },

  // Server
  "Nginx": { pattern: /nginx/i, category: "server" },
  "Apache": { pattern: /apache/i, category: "server" },
  "IIS": { pattern: /iis|microsoft-iis/i, category: "server" },
  "LiteSpeed": { pattern: /litespeed/i, category: "server" },

  // Hosting
  "Vercel": { pattern: /vercel|\.vercel\.app/i, category: "hosting" },
  "Netlify": { pattern: /netlify/i, category: "hosting" },
  "Heroku": { pattern: /heroku/i, category: "hosting" },
  "AWS": { pattern: /amazonaws\.com/i, category: "hosting" },
  "Google Cloud": { pattern: /googleapis\.com|\.run\.app/i, category: "hosting" },
};

export async function detectTechStack(url: string): Promise<TechStackResult> {
  const result: TechStackResult = {
    url,
    javascript: [],
    css: [],
    analytics: [],
    security: [],
    headers: {},
  };

  try {
    // Fetch the page HTML + headers
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TechDetect/1.0)" },
    });

    // Analyze headers
    for (const [key, value] of response.headers.entries()) {
      result.headers[key] = value;
      const k = key.toLowerCase();
      if (k === "server") result.server = value;
      if (k === "x-powered-by") result.framework = value;
    }

    const html = await response.text();

    // Match against all signatures
    for (const [tech, { pattern, category }] of Object.entries(TECH_SIGNATURES)) {
      const matchesHtml = pattern.test(html);
      const matchesHeaders = Object.values(result.headers).some(v => pattern.test(v));

      if (matchesHtml || matchesHeaders) {
        if (category === "javascript") result.javascript.push(tech);
        else if (category === "css") result.css.push(tech);
        else if (category === "analytics") result.analytics.push(tech);
        else if (category === "security") result.security.push(tech);
        else if (category === "cms") result.cms = tech;
        else if (category === "cdn") result.cdn = tech;
        else if (category === "hosting") result.hosting = tech;
        else if (category === "server" && !result.server) result.server = tech;
      }
    }

    // Detect meta generator tag
    const generatorMatch = html.match(/<meta[^>]*name=["']generator["'][^>]*content=["']([^"']+)/i);
    if (generatorMatch) {
      result.cms = result.cms || generatorMatch[1];
    }
  } catch {}

  return result;
}

// ── Robots.txt Analysis ─────────────────────────────────

export async function analyzeRobots(baseUrl: string): Promise<RobotsAnalysis> {
  const result: RobotsAnalysis = {
    userAgents: [],
    disallowed: [],
    allowed: [],
    sitemaps: [],
  };

  try {
    const robotsUrl = baseUrl.replace(/\/+$/, "") + "/robots.txt";
    const response = await fetch(robotsUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return result;

    const text = await response.text();

    for (const line of text.split("\n")) {
      const trimmed = line.split("#")[0].trim();
      if (!trimmed) continue;

      const [directive, ...valueParts] = trimmed.split(":");
      const value = valueParts.join(":").trim();
      const dir = directive.toLowerCase();

      if (dir === "user-agent" && value) result.userAgents.push(value);
      else if (dir === "disallow" && value) result.disallowed.push(value);
      else if (dir === "allow" && value) result.allowed.push(value);
      else if (dir === "sitemap" && value) result.sitemaps.push(value);
      else if (dir === "crawl-delay" && value) result.crawlDelay = parseInt(value, 10);
    }
  } catch {}

  return result;
}

// ── Sitemap Parsing ─────────────────────────────────────

export async function parseSitemap(sitemapUrl: string): Promise<SiteMapEntry[]> {
  const entries: SiteMapEntry[] = [];

  try {
    const response = await fetch(sitemapUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return entries;

    const text = await response.text();

    // Simple XML parsing for sitemap entries
    const urlMatches = text.matchAll(/<url>([\s\S]*?)<\/url>/gi);
    for (const match of urlMatches) {
      const block = match[1];
      const locMatch = block.match(/<loc>\s*(.*?)\s*<\/loc>/i);
      const lastmodMatch = block.match(/<lastmod>\s*(.*?)\s*<\/lastmod>/i);
      const priorityMatch = block.match(/<priority>\s*(.*?)\s*<\/priority>/i);

      if (locMatch) {
        entries.push({
          url: locMatch[1],
          lastmod: lastmodMatch?.[1],
          priority: priorityMatch?.[1],
        });
      }
    }

    // Handle sitemap index
    const sitemapMatches = text.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi);
    for (const match of sitemapMatches) {
      const locMatch = match[1].match(/<loc>\s*(.*?)\s*<\/loc>/i);
      if (locMatch) {
        // Recursively parse sub-sitemaps (limit depth)
        const subEntries = await parseSitemap(locMatch[1]);
        entries.push(...subEntries.slice(0, 100));
      }
    }
  } catch {}

  return entries;
}

// ── Link Extraction ─────────────────────────────────────

export interface ExtractedLink {
  url: string;
  text: string;
  type: "internal" | "external" | "resource";
  rel?: string;
}

export async function extractLinks(url: string): Promise<ExtractedLink[]> {
  const links: ExtractedLink[] = [];

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LinkExtractor/1.0)" },
    });
    const html = await response.text();
    const baseHost = new URL(url).hostname;

    // Extract <a> tags
    const aMatches = html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
    for (const match of aMatches) {
      const href = match[1];
      const text = match[2].replace(/<[^>]+>/g, "").trim().slice(0, 100);
      const rel = match[0].match(/rel=["']([^"']+)/i)?.[1];

      try {
        const resolved = new URL(href, url);
        const type = resolved.hostname === baseHost ? "internal" : "external";
        links.push({ url: resolved.href, text, type, rel });
      } catch {
        // Relative or malformed URL
        links.push({ url: href, text, type: "internal", rel });
      }
    }

    // Extract <script src> and <link href>
    const resourceMatches = html.matchAll(/<(?:script|link)\s+[^>]*(?:src|href)=["']([^"']+)["']/gi);
    for (const match of resourceMatches) {
      try {
        const resolved = new URL(match[1], url);
        links.push({ url: resolved.href, text: "", type: "resource" });
      } catch {}
    }
  } catch {}

  return links;
}

// ── Full Web Intelligence ───────────────────────────────

export interface WebIntelResult {
  target: string;
  techStack: TechStackResult;
  robots: RobotsAnalysis;
  sitemapEntries: SiteMapEntry[];
  wayback: { firstSeen?: string; lastSeen?: string; totalSnapshots: number };
  dorks: Record<string, string>;
  links: { internal: number; external: number; resources: number };
  timestamp: string;
}

export async function fullWebIntel(url: string): Promise<WebIntelResult> {
  const domain = new URL(url).hostname;

  const [techStack, robots, wayback] = await Promise.all([
    detectTechStack(url),
    analyzeRobots(url),
    waybackDiff(url),
  ]);

  // Parse sitemaps found in robots.txt
  let sitemapEntries: SiteMapEntry[] = [];
  if (robots.sitemaps.length > 0) {
    const allEntries = await Promise.all(robots.sitemaps.map(s => parseSitemap(s)));
    sitemapEntries = allEntries.flat().slice(0, 200);
  } else {
    sitemapEntries = await parseSitemap(url.replace(/\/+$/, "") + "/sitemap.xml");
  }

  const dorks = generateDorks(domain);
  const links = await extractLinks(url);

  return {
    target: url,
    techStack,
    robots,
    sitemapEntries: sitemapEntries.slice(0, 100),
    wayback: {
      firstSeen: wayback.firstSeen,
      lastSeen: wayback.lastSeen,
      totalSnapshots: wayback.totalSnapshots,
    },
    dorks,
    links: {
      internal: links.filter(l => l.type === "internal").length,
      external: links.filter(l => l.type === "external").length,
      resources: links.filter(l => l.type === "resource").length,
    },
    timestamp: new Date().toISOString(),
  };
}
