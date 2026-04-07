/**
 * News Collector — multi-source news aggregation with cache-layer full-text extraction
 * Google News RSS, publisher RSS, Google Cache, Wayback snapshots, OG meta extraction
 * No API keys, no subscriptions
 */

export interface NewsArticle {
  title: string;
  url: string;
  source: string;
  published?: string;
  summary?: string;
  fullText?: string;
  imageUrl?: string;
  author?: string;
  language?: string;
  category?: string;
}

export interface NewsCollectorResult {
  query: string;
  articles: NewsArticle[];
  sources: { name: string; count: number }[];
  stats: {
    totalArticles: number;
    withFullText: number;
    sourcesQueried: number;
    durationMs: number;
  };
  timestamp: string;
}

// ── RSS Feed Sources ────────────────────────────────────

interface RssFeed {
  name: string;
  url: string;
  category: string;
  language: string;
}

const NEWS_FEEDS: RssFeed[] = [
  // International — English
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/topNews", category: "world", language: "en" },
  { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", category: "world", language: "en" },
  { name: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", category: "business", language: "en" },
  { name: "BBC Technology", url: "https://feeds.bbci.co.uk/news/technology/rss.xml", category: "tech", language: "en" },
  { name: "AP News", url: "https://rsshub.app/apnews/topics/apf-topnews", category: "world", language: "en" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", category: "world", language: "en" },

  // Finance/Business — English
  { name: "CNBC Top", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", category: "finance", language: "en" },
  { name: "CNBC Business", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147", category: "finance", language: "en" },
  { name: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", category: "finance", language: "en" },
  { name: "Financial Times", url: "https://www.ft.com/rss/home", category: "finance", language: "en" },
  { name: "Bloomberg", url: "https://feeds.bloomberg.com/markets/news.rss", category: "finance", language: "en" },
  { name: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex", category: "finance", language: "en" },
  { name: "WSJ World", url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml", category: "finance", language: "en" },
  { name: "WSJ Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", category: "finance", language: "en" },
  { name: "WSJ Tech", url: "https://feeds.a.dj.com/rss/RSSWSJD.xml", category: "tech", language: "en" },
  { name: "Economist", url: "https://www.economist.com/rss", category: "finance", language: "en" },

  // Technology — English
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", category: "tech", language: "en" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", category: "tech", language: "en" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "tech", language: "en" },
  { name: "Wired", url: "https://www.wired.com/feed/rss", category: "tech", language: "en" },
  { name: "Hacker News", url: "https://hnrss.org/frontpage", category: "tech", language: "en" },

  // Security
  { name: "TheHackersNews", url: "https://feeds.feedburner.com/TheHackersNews", category: "security", language: "en" },
  { name: "BleepingComputer", url: "https://www.bleepingcomputer.com/feed/", category: "security", language: "en" },
  { name: "KrebsOnSecurity", url: "https://krebsonsecurity.com/feed/", category: "security", language: "en" },

  // China — Chinese
  { name: "新华社", url: "http://www.xinhuanet.com/politics/news_politics.xml", category: "world", language: "zh" },
  { name: "36氪", url: "https://36kr.com/feed", category: "tech", language: "zh" },
  { name: "少数派", url: "https://sspai.com/feed", category: "tech", language: "zh" },
  { name: "InfoQ中文", url: "https://www.infoq.cn/feed", category: "tech", language: "zh" },
];

// ── RSS Parser (no dependencies) ────────────────────────

function parseRss(xml: string, sourceName: string): NewsArticle[] {
  const articles: NewsArticle[] = [];

  // RSS 2.0 items
  const items = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
  for (const item of items) {
    const block = item[1];
    articles.push(parseRssItem(block, sourceName));
  }

  // Atom entries
  if (articles.length === 0) {
    const entries = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi);
    for (const entry of entries) {
      articles.push(parseAtomEntry(entry[1], sourceName));
    }
  }

  return articles;
}

function parseRssItem(block: string, source: string): NewsArticle {
  const title = extractTag(block, "title");
  const link = extractTag(block, "link") || extractTag(block, "guid");
  const pubDate = extractTag(block, "pubDate");
  const description = extractTag(block, "description");
  const author = extractTag(block, "dc:creator") || extractTag(block, "author");
  const imgMatch = block.match(/<media:content[^>]*url=["']([^"']+)/i) ||
                   block.match(/<enclosure[^>]*url=["']([^"']+)/i) ||
                   description?.match(/<img[^>]*src=["']([^"']+)/i);

  return {
    title: stripHtml(title || ""),
    url: link || "",
    source,
    published: pubDate,
    summary: stripHtml(description || "").slice(0, 500),
    imageUrl: imgMatch?.[1],
    author: stripHtml(author || ""),
  };
}

function parseAtomEntry(block: string, source: string): NewsArticle {
  const title = extractTag(block, "title");
  const link = block.match(/<link[^>]*href=["']([^"']+)/i)?.[1] || "";
  const updated = extractTag(block, "updated") || extractTag(block, "published");
  const summary = extractTag(block, "summary") || extractTag(block, "content");
  const author = extractTag(block, "name");

  return {
    title: stripHtml(title || ""),
    url: link,
    source,
    published: updated,
    summary: stripHtml(summary || "").slice(0, 500),
    author: stripHtml(author || ""),
  };
}

function extractTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
  return match?.[1]?.trim();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// ── Google News RSS Search ──────────────────────────────

export async function searchGoogleNews(query: string, options: { language?: string; count?: number } = {}): Promise<NewsArticle[]> {
  const lang = options.language || "en";
  const articles: NewsArticle[] = [];

  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${lang}&gl=US&ceid=US:en`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Panopticon/1.0)" },
    });
    if (response.ok) {
      const xml = await response.text();
      const parsed = parseRss(xml, "Google News");
      articles.push(...parsed.slice(0, options.count || 20));
    }
  } catch {}

  // Also try Chinese Google News
  if (lang === "zh" || lang === "all") {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (response.ok) {
        const xml = await response.text();
        articles.push(...parseRss(xml, "Google News CN"));
      }
    } catch {}
  }

  return articles;
}

// ── Fetch RSS Feed ──────────────────────────────────────

async function fetchFeed(feed: RssFeed): Promise<NewsArticle[]> {
  try {
    const response = await fetch(feed.url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Panopticon/1.0)" },
    });
    if (!response.ok) return [];
    const xml = await response.text();
    const articles = parseRss(xml, feed.name);
    return articles.map(a => ({ ...a, language: feed.language, category: feed.category }));
  } catch {
    return [];
  }
}

// ── Google Cache Full Text ──────────────────────────────

export async function fetchGoogleCache(articleUrl: string): Promise<string | null> {
  try {
    const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(articleUrl)}&strip=1`;
    const response = await fetch(cacheUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!response.ok) return null;
    const html = await response.text();
    return extractArticleText(html);
  } catch {
    return null;
  }
}

// ── Wayback Machine Latest Snapshot ─────────────────────

export async function fetchWaybackVersion(articleUrl: string): Promise<string | null> {
  try {
    // Get latest snapshot URL
    const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(articleUrl)}`;
    const apiResp = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
    if (!apiResp.ok) return null;
    const apiData = await apiResp.json();
    const snapshotUrl = apiData.archived_snapshots?.closest?.url;
    if (!snapshotUrl) return null;

    // Fetch archived page
    const response = await fetch(snapshotUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const html = await response.text();
    return extractArticleText(html);
  } catch {
    return null;
  }
}

// ── Direct Fetch (works for JS paywalls) ────────────────

export async function fetchDirectContent(articleUrl: string): Promise<string | null> {
  try {
    const response = await fetch(articleUrl, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept": "text/html",
      },
    });
    if (!response.ok) return null;
    const html = await response.text();
    return extractArticleText(html);
  } catch {
    return null;
  }
}

// ── Extract Article Text from HTML ──────────────────────

function extractArticleText(html: string): string {
  // Remove scripts, styles, nav, footer, header, ads
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Try to find article body
  const articleMatch = clean.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) clean = articleMatch[1];
  else {
    // Try common content selectors
    const contentMatch = clean.match(
      /<div[^>]*class="[^"]*(?:article-body|story-body|post-content|entry-content|article-content|article__body|story-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    if (contentMatch) clean = contentMatch[1];
  }

  // Extract paragraphs
  const paragraphs: string[] = [];
  const pMatches = clean.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  for (const m of pMatches) {
    const text = stripHtml(m[1]).trim();
    if (text.length > 30) paragraphs.push(text); // Filter short/noise paragraphs
  }

  if (paragraphs.length > 0) return paragraphs.join("\n\n");

  // Fallback: strip all HTML
  return stripHtml(clean).replace(/\s+/g, " ").trim().slice(0, 5000);
}

// ── OG Meta Extraction ──────────────────────────────────

export async function extractOgMeta(url: string): Promise<{ title?: string; description?: string; image?: string; siteName?: string }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Panopticon/1.0)" },
    });
    if (!response.ok) return {};
    const html = await response.text();

    const og: Record<string, string> = {};
    const metaMatches = html.matchAll(/<meta\s+[^>]*(?:property|name)=["'](og:[^"']+|twitter:[^"']+)["'][^>]*content=["']([^"']*)["']/gi);
    for (const m of metaMatches) og[m[1]] = m[2];
    // Reversed order
    const revMatches = html.matchAll(/<meta\s+[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["'](og:[^"']+|twitter:[^"']+)["']/gi);
    for (const m of revMatches) og[m[2]] = m[1];

    return {
      title: og["og:title"] || og["twitter:title"],
      description: og["og:description"] || og["twitter:description"],
      image: og["og:image"] || og["twitter:image"],
      siteName: og["og:site_name"],
    };
  } catch {
    return {};
  }
}

// ── Full Text Retrieval (tries multiple sources) ────────

export async function getFullText(articleUrl: string): Promise<{ text: string | null; source: string }> {
  // Try 1: Direct fetch (catches JS paywalls that serve full HTML)
  const direct = await fetchDirectContent(articleUrl);
  if (direct && direct.length > 200) return { text: direct, source: "direct" };

  // Try 2: Google Cache
  const cached = await fetchGoogleCache(articleUrl);
  if (cached && cached.length > 200) return { text: cached, source: "google-cache" };

  // Try 3: Wayback Machine
  const wayback = await fetchWaybackVersion(articleUrl);
  if (wayback && wayback.length > 200) return { text: wayback, source: "wayback" };

  return { text: null, source: "none" };
}

// ── Main News Collector ─────────────────────────────────

export async function collectNews(
  query: string,
  options: {
    categories?: string[];
    languages?: string[];
    maxPerSource?: number;
    fetchFullText?: boolean;
    feedNames?: string[];
  } = {}
): Promise<NewsCollectorResult> {
  const start = Date.now();
  const maxPerSource = options.maxPerSource || 10;
  const allArticles: NewsArticle[] = [];
  const sourceCounts: Record<string, number> = {};
  let sourcesQueried = 0;

  // 1. Google News RSS search
  const googleArticles = await searchGoogleNews(query, {
    language: options.languages?.includes("zh") ? "all" : "en",
    count: maxPerSource,
  });
  allArticles.push(...googleArticles);
  sourceCounts["Google News"] = googleArticles.length;
  sourcesQueried++;

  // 2. Publisher RSS feeds
  let feeds = NEWS_FEEDS;
  if (options.categories?.length) {
    feeds = feeds.filter(f => options.categories!.includes(f.category));
  }
  if (options.languages?.length) {
    feeds = feeds.filter(f => options.languages!.includes(f.language));
  }
  if (options.feedNames?.length) {
    feeds = feeds.filter(f => options.feedNames!.some(n => f.name.toLowerCase().includes(n.toLowerCase())));
  }

  // Fetch feeds in parallel (batches of 5)
  for (let i = 0; i < feeds.length; i += 5) {
    const batch = feeds.slice(i, i + 5);
    const results = await Promise.all(batch.map(fetchFeed));
    for (let j = 0; j < batch.length; j++) {
      const feedArticles = results[j];
      // Filter by query keyword
      const queryLower = query.toLowerCase();
      const matching = feedArticles.filter(a =>
        a.title.toLowerCase().includes(queryLower) ||
        (a.summary || "").toLowerCase().includes(queryLower)
      );
      // Only add matching articles — don't add unrelated content
      const toAdd = matching.slice(0, maxPerSource);
      allArticles.push(...toAdd);
      sourceCounts[batch[j].name] = toAdd.length;
      sourcesQueried++;
    }
  }

  // 3. Optionally fetch full text for top articles
  let withFullText = 0;
  if (options.fetchFullText) {
    const topArticles = allArticles.filter(a => a.url && !a.fullText).slice(0, 5);
    for (const article of topArticles) {
      const { text, source } = await getFullText(article.url);
      if (text) {
        article.fullText = text;
        withFullText++;
      }
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const deduped = allArticles.filter(a => {
    if (!a.url || seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });

  // Sort by date (newest first)
  deduped.sort((a, b) => {
    const da = a.published ? new Date(a.published).getTime() : 0;
    const db = b.published ? new Date(b.published).getTime() : 0;
    return db - da;
  });

  return {
    query,
    articles: deduped,
    sources: Object.entries(sourceCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    stats: {
      totalArticles: deduped.length,
      withFullText,
      sourcesQueried,
      durationMs: Date.now() - start,
    },
    timestamp: new Date().toISOString(),
  };
}
