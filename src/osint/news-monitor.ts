/**
 * News & Security Feed Monitor — track mentions of targets in RSS/Atom feeds
 * Monitors security advisories, news, and CVE feeds
 */

export interface NewsMonitorResult {
  query: string;
  articles: NewsArticle[];
  securityAdvisories: NewsArticle[];
  stats: { totalArticles: number; securityRelated: number; sourcesChecked: number };
  timestamp: string;
}

export interface NewsArticle {
  title: string;
  url: string;
  source: string;
  published?: string;
  snippet?: string;
  isSecurityRelated: boolean;
}

const SECURITY_KEYWORDS = /vulnerab|exploit|breach|hack|attack|malware|phishing|ransomware|cve-|zero.day|patch|critical|incident|compromise|leak|exposure/i;

// ── RSS/Atom Feed Parser (simple, no dependencies) ──────

async function fetchFeed(feedUrl: string): Promise<NewsArticle[]> {
  const articles: NewsArticle[] = [];

  try {
    const response = await fetch(feedUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "OSINT-Agent-News-Monitor" },
    });
    if (!response.ok) return articles;

    const xml = await response.text();
    const source = feedUrl.replace(/https?:\/\//, "").split("/")[0];

    // Parse RSS items
    const items = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
    for (const item of items) {
      const block = item[1];
      const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() || "";
      const link = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() || "";
      const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim();
      const desc = block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1]?.trim() || "";

      articles.push({
        title: title.replace(/<[^>]+>/g, ""),
        url: link,
        source,
        published: pubDate,
        snippet: desc.replace(/<[^>]+>/g, "").slice(0, 200),
        isSecurityRelated: SECURITY_KEYWORDS.test(title + " " + desc),
      });
    }

    // Parse Atom entries
    const entries = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi);
    for (const entry of entries) {
      const block = entry[1];
      const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "";
      const link = block.match(/<link[^>]*href=["']([^"']+)/i)?.[1] || "";
      const updated = block.match(/<(?:updated|published)>([\s\S]*?)<\/(?:updated|published)>/i)?.[1]?.trim();
      const summary = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1]?.trim() || "";

      articles.push({
        title: title.replace(/<[^>]+>/g, ""),
        url: link,
        source,
        published: updated,
        snippet: summary.replace(/<[^>]+>/g, "").slice(0, 200),
        isSecurityRelated: SECURITY_KEYWORDS.test(title + " " + summary),
      });
    }
  } catch {}

  return articles;
}

// ── Security Feeds (free, no key) ───────────────────────

const SECURITY_FEEDS = [
  "https://feeds.feedburner.com/TheHackersNews",
  "https://www.bleepingcomputer.com/feed/",
  "https://krebsonsecurity.com/feed/",
  "https://www.darkreading.com/rss.xml",
  "https://threatpost.com/feed/",
  "https://www.schneier.com/feed/",
  "https://nakedsecurity.sophos.com/feed/",
  "https://www.cert.org/rss/vuls.xml",
];

const GENERAL_FEEDS = [
  "https://news.ycombinator.com/rss",
  "https://www.reddit.com/r/netsec/.rss",
  "https://www.reddit.com/r/cybersecurity/.rss",
];

// ── Search for Target Mentions ──────────────────────────

export async function monitorNews(
  query: string,
  options: { includeGeneral?: boolean; maxFeeds?: number } = {}
): Promise<NewsMonitorResult> {
  const feeds = [...SECURITY_FEEDS];
  if (options.includeGeneral) feeds.push(...GENERAL_FEEDS);
  const maxFeeds = options.maxFeeds || feeds.length;

  const allArticles: NewsArticle[] = [];
  let sourcesChecked = 0;

  for (const feedUrl of feeds.slice(0, maxFeeds)) {
    const articles = await fetchFeed(feedUrl);
    sourcesChecked++;

    // Filter for mentions of the query
    const queryLower = query.toLowerCase();
    const matching = articles.filter(a =>
      a.title.toLowerCase().includes(queryLower) ||
      (a.snippet || "").toLowerCase().includes(queryLower)
    );

    allArticles.push(...matching);
  }

  // If no direct matches, return latest security articles
  const securityAdvisories = allArticles.filter(a => a.isSecurityRelated);

  return {
    query,
    articles: allArticles.slice(0, 50),
    securityAdvisories: securityAdvisories.slice(0, 20),
    stats: {
      totalArticles: allArticles.length,
      securityRelated: securityAdvisories.length,
      sourcesChecked,
    },
    timestamp: new Date().toISOString(),
  };
}
