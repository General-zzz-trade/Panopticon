/**
 * OSINT Deep Crawler — multi-page recursive site crawl + screenshot capture
 * Uses native fetch for crawling, Playwright for screenshots
 */

export interface CrawlPage {
  url: string;
  status: number;
  title?: string;
  links: { url: string; text: string; type: "internal" | "external" }[];
  forms: { action: string; method: string; inputs: string[] }[];
  emails: string[];
  phones: string[];
  comments: string[];
  metaTags: Record<string, string>;
  size: number;
  loadTimeMs: number;
}

export interface CrawlResult {
  baseUrl: string;
  pages: CrawlPage[];
  siteMap: Record<string, string[]>;  // url → outgoing links
  allEmails: string[];
  allPhones: string[];
  externalDomains: string[];
  stats: {
    pagesVisited: number;
    totalLinks: number;
    totalForms: number;
    totalEmails: number;
    durationMs: number;
  };
  timestamp: string;
}

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  respectRobots?: boolean;
  delayMs?: number;
  includeExternal?: boolean;
  timeout?: number;
}

// ── Robots.txt Parser ───────────────────────────────────

async function fetchDisallowedPaths(baseUrl: string): Promise<Set<string>> {
  const disallowed = new Set<string>();
  try {
    const response = await fetch(new URL("/robots.txt", baseUrl).href, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return disallowed;
    const text = await response.text();
    let applies = false;
    for (const line of text.split("\n")) {
      const trimmed = line.split("#")[0].trim().toLowerCase();
      if (trimmed.startsWith("user-agent:")) applies = trimmed.includes("*");
      if (applies && trimmed.startsWith("disallow:")) {
        const path = trimmed.split(":").slice(1).join(":").trim();
        if (path) disallowed.add(path);
      }
    }
  } catch {}
  return disallowed;
}

function isDisallowed(url: string, disallowed: Set<string>): boolean {
  try {
    const path = new URL(url).pathname;
    for (const rule of disallowed) {
      if (path.startsWith(rule)) return true;
    }
  } catch {}
  return false;
}

// ── HTML Parser Helpers ─────────────────────────────────

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.trim();
}

function extractLinks(html: string, baseUrl: string): CrawlPage["links"] {
  const links: CrawlPage["links"] = [];
  const baseHost = new URL(baseUrl).hostname;
  const matches = html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);

  for (const match of matches) {
    try {
      const resolved = new URL(match[1], baseUrl);
      if (!["http:", "https:"].includes(resolved.protocol)) continue;
      const text = match[2].replace(/<[^>]+>/g, "").trim().slice(0, 100);
      links.push({
        url: resolved.href,
        text,
        type: resolved.hostname === baseHost ? "internal" : "external",
      });
    } catch {}
  }
  return links;
}

function extractForms(html: string, baseUrl: string): CrawlPage["forms"] {
  const forms: CrawlPage["forms"] = [];
  const formMatches = html.matchAll(/<form\s+[^>]*>([\s\S]*?)<\/form>/gi);

  for (const match of formMatches) {
    const formTag = match[0];
    const actionMatch = formTag.match(/action=["']([^"']*)/i);
    const methodMatch = formTag.match(/method=["']([^"']*)/i);
    const inputMatches = match[1].matchAll(/<input[^>]*name=["']([^"']+)/gi);
    const inputs: string[] = [];
    for (const inp of inputMatches) inputs.push(inp[1]);

    forms.push({
      action: actionMatch?.[1] || baseUrl,
      method: (methodMatch?.[1] || "GET").toUpperCase(),
      inputs,
    });
  }
  return forms;
}

function extractEmails(html: string): string[] {
  const emails = html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
  return [...new Set(emails)];
}

function extractPhones(html: string): string[] {
  const phones = html.match(/(?:\+?\d{1,3}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}/g) || [];
  return [...new Set(phones.filter(p => p.replace(/\D/g, "").length >= 7))];
}

function extractComments(html: string): string[] {
  const comments: string[] = [];
  const matches = html.matchAll(/<!--([\s\S]*?)-->/g);
  for (const m of matches) {
    const c = m[1].trim();
    if (c && c.length > 3 && c.length < 500) comments.push(c);
  }
  return comments;
}

function extractMetaTags(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const matches = html.matchAll(/<meta\s+[^>]*(?:name|property)=["']([^"']+)["'][^>]*content=["']([^"']+)["']/gi);
  for (const m of matches) meta[m[1]] = m[2];
  // Also match reversed order
  const revMatches = html.matchAll(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']([^"']+)["']/gi);
  for (const m of revMatches) meta[m[2]] = m[1];
  return meta;
}

// ── Main Crawler ────────────────────────────────────────

export async function crawlSite(startUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  const maxPages = options.maxPages || 30;
  const maxDepth = options.maxDepth || 3;
  const delayMs = options.delayMs || 200;
  const timeout = options.timeout || 10000;
  const startTime = Date.now();

  const baseHost = new URL(startUrl).hostname;
  const visited = new Set<string>();
  const pages: CrawlPage[] = [];
  const siteMap: Record<string, string[]> = {};
  const allEmails = new Set<string>();
  const allPhones = new Set<string>();
  const externalDomains = new Set<string>();

  // Respect robots.txt
  let disallowed = new Set<string>();
  if (options.respectRobots !== false) {
    disallowed = await fetchDisallowedPaths(startUrl);
  }

  // BFS crawl
  const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];

  while (queue.length > 0 && pages.length < maxPages) {
    const { url, depth } = queue.shift()!;

    // Normalize URL
    let normalized: string;
    try {
      const u = new URL(url);
      u.hash = "";
      normalized = u.href;
    } catch { continue; }

    if (visited.has(normalized)) continue;
    if (depth > maxDepth) continue;
    if (isDisallowed(normalized, disallowed)) continue;

    visited.add(normalized);

    // Fetch page
    const pageStart = Date.now();
    try {
      const response = await fetch(normalized, {
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OSINTCrawler/1.0)" },
      });

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) continue;

      const html = await response.text();
      const loadTimeMs = Date.now() - pageStart;

      const links = extractLinks(html, normalized);
      const forms = extractForms(html, normalized);
      const emails = extractEmails(html);
      const phones = extractPhones(html);
      const comments = extractComments(html);
      const metaTags = extractMetaTags(html);

      pages.push({
        url: normalized,
        status: response.status,
        title: extractTitle(html),
        links,
        forms,
        emails,
        phones,
        comments,
        metaTags,
        size: html.length,
        loadTimeMs,
      });

      siteMap[normalized] = links.filter(l => l.type === "internal").map(l => l.url);

      // Collect intelligence
      emails.forEach(e => allEmails.add(e));
      phones.forEach(p => allPhones.add(p));
      links.filter(l => l.type === "external").forEach(l => {
        try { externalDomains.add(new URL(l.url).hostname); } catch {}
      });

      // Queue internal links
      for (const link of links) {
        if (link.type === "internal" && !visited.has(link.url)) {
          queue.push({ url: link.url, depth: depth + 1 });
        }
      }

      // Polite delay
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    } catch {}
  }

  return {
    baseUrl: startUrl,
    pages,
    siteMap,
    allEmails: [...allEmails],
    allPhones: [...allPhones],
    externalDomains: [...externalDomains],
    stats: {
      pagesVisited: pages.length,
      totalLinks: pages.reduce((sum, p) => sum + p.links.length, 0),
      totalForms: pages.reduce((sum, p) => sum + p.forms.length, 0),
      totalEmails: allEmails.size,
      durationMs: Date.now() - startTime,
    },
    timestamp: new Date().toISOString(),
  };
}

// ── Screenshot Capture ──────────────────────────────────

export interface ScreenshotResult {
  url: string;
  screenshotBase64?: string;
  viewportWidth: number;
  viewportHeight: number;
  fullPageHeight?: number;
  error?: string;
  timestamp: string;
}

export async function captureScreenshot(
  url: string,
  options: { width?: number; height?: number; fullPage?: boolean } = {}
): Promise<ScreenshotResult> {
  const width = options.width || 1280;
  const height = options.height || 720;

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width, height } });

    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    const screenshot = await page.screenshot({
      fullPage: options.fullPage ?? true,
      type: "png",
    });

    const fullPageHeight = await page.evaluate(() => document.body.scrollHeight);

    await browser.close();

    return {
      url,
      screenshotBase64: screenshot.toString("base64"),
      viewportWidth: width,
      viewportHeight: height,
      fullPageHeight,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      url,
      viewportWidth: width,
      viewportHeight: height,
      error: err instanceof Error ? err.message : "Screenshot failed",
      timestamp: new Date().toISOString(),
    };
  }
}
