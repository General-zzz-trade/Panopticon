/**
 * Social Media Content Collector — scrape public posts from Reddit, HN, Telegram
 * All public data, no API keys needed
 */

export interface SocialPost {
  platform: string;
  author: string;
  content: string;
  url: string;
  timestamp?: string;
  score?: number;
  comments?: number;
  subreddit?: string;
}

export interface SocialMediaResult {
  query: string;
  posts: SocialPost[];
  platforms: { name: string; count: number }[];
  stats: { totalPosts: number; platformsQueried: number; durationMs: number };
  timestamp: string;
}

// ── Reddit (public JSON API — no auth needed) ───────────

export async function searchReddit(query: string, options: { subreddit?: string; sort?: string; limit?: number } = {}): Promise<SocialPost[]> {
  const posts: SocialPost[] = [];
  const sort = options.sort || "relevance";
  const limit = options.limit || 25;

  try {
    const baseUrl = options.subreddit
      ? `https://www.reddit.com/r/${options.subreddit}/search.json`
      : "https://www.reddit.com/search.json";

    const url = `${baseUrl}?q=${encodeURIComponent(query)}&sort=${sort}&limit=${limit}&restrict_sr=${options.subreddit ? "true" : "false"}`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Panopticon/1.0 OSINT Research" },
    });

    if (!response.ok) return posts;
    const data = await response.json();

    for (const child of (data.data?.children || [])) {
      const post = child.data;
      if (!post) continue;

      posts.push({
        platform: "Reddit",
        author: post.author || "[deleted]",
        content: (post.title || "") + (post.selftext ? "\n\n" + post.selftext.slice(0, 1000) : ""),
        url: `https://www.reddit.com${post.permalink}`,
        timestamp: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : undefined,
        score: post.score,
        comments: post.num_comments,
        subreddit: post.subreddit,
      });
    }
  } catch {}

  return posts;
}

// ── Reddit: Subreddit Top Posts ──────────────────────────

export async function getSubredditPosts(subreddit: string, sort = "hot", limit = 25): Promise<SocialPost[]> {
  const posts: SocialPost[] = [];

  try {
    const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Panopticon/1.0 OSINT Research" },
    });

    if (!response.ok) return posts;
    const data = await response.json();

    for (const child of (data.data?.children || [])) {
      const post = child.data;
      if (!post) continue;

      posts.push({
        platform: "Reddit",
        author: post.author || "[deleted]",
        content: (post.title || "") + (post.selftext ? "\n" + post.selftext.slice(0, 500) : ""),
        url: `https://www.reddit.com${post.permalink}`,
        timestamp: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : undefined,
        score: post.score,
        comments: post.num_comments,
        subreddit: post.subreddit,
      });
    }
  } catch {}

  return posts;
}

// ── Hacker News (Algolia API — free, no key) ────────────

export async function searchHackerNews(query: string, options: { limit?: number; sort?: string } = {}): Promise<SocialPost[]> {
  const posts: SocialPost[] = [];
  const limit = options.limit || 20;

  try {
    const endpoint = options.sort === "date"
      ? "search_by_date"
      : "search";

    const url = `https://hn.algolia.com/api/v1/${endpoint}?query=${encodeURIComponent(query)}&hitsPerPage=${limit}&tags=story`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!response.ok) return posts;
    const data = await response.json();

    for (const hit of (data.hits || [])) {
      posts.push({
        platform: "Hacker News",
        author: hit.author || "",
        content: hit.title || "",
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        timestamp: hit.created_at,
        score: hit.points,
        comments: hit.num_comments,
      });
    }
  } catch {}

  return posts;
}

// ── Telegram Public Channel (clearnet, no auth) ─────────

export async function scrapeTelegramChannel(channel: string, limit = 20): Promise<SocialPost[]> {
  const posts: SocialPost[] = [];
  const clean = channel.replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "");

  try {
    // t.me/s/ is the public clearnet view of channels
    const response = await fetch(`https://t.me/s/${clean}`, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!response.ok) return posts;
    const html = await response.text();

    // Parse message blocks
    const messages = html.matchAll(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi);

    for (const msg of messages) {
      const text = msg[1].replace(/<[^>]+>/g, "").trim();
      if (text.length < 5) continue;

      // Try to get timestamp
      const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)/i);

      posts.push({
        platform: "Telegram",
        author: `@${clean}`,
        content: text.slice(0, 1000),
        url: `https://t.me/${clean}`,
        timestamp: timeMatch?.[1],
      });

      if (posts.length >= limit) break;
    }
  } catch {}

  return posts;
}

// ── GitHub Discussions / Issues ──────────────────────────

export async function searchGithubDiscussions(query: string, limit = 10): Promise<SocialPost[]> {
  const posts: SocialPost[] = [];

  try {
    // Search issues (public, no auth needed but rate limited)
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=updated&per_page=${limit}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "Panopticon-OSINT" },
    });

    if (!response.ok) return posts;
    const data = await response.json();

    for (const item of (data.items || [])) {
      posts.push({
        platform: "GitHub",
        author: item.user?.login || "",
        content: `${item.title}\n${(item.body || "").slice(0, 500)}`,
        url: item.html_url,
        timestamp: item.updated_at,
        comments: item.comments,
      });
    }
  } catch {}

  return posts;
}

// ── Stack Overflow ──────────────────────────────────────

export async function searchStackOverflow(query: string, limit = 10): Promise<SocialPost[]> {
  const posts: SocialPost[] = [];

  try {
    const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=${limit}&filter=withbody`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!response.ok) return posts;
    const data = await response.json();

    for (const item of (data.items || [])) {
      posts.push({
        platform: "StackOverflow",
        author: item.owner?.display_name || "",
        content: `${item.title}\n${(item.body || "").replace(/<[^>]+>/g, "").slice(0, 500)}`,
        url: item.link,
        timestamp: item.last_activity_date ? new Date(item.last_activity_date * 1000).toISOString() : undefined,
        score: item.score,
        comments: item.answer_count,
      });
    }
  } catch {}

  return posts;
}

// ── Full Social Media Search ────────────────────────────

export async function collectSocialMedia(
  query: string,
  options: {
    platforms?: ("reddit" | "hackernews" | "telegram" | "github" | "stackoverflow")[];
    subreddits?: string[];
    telegramChannels?: string[];
    limit?: number;
  } = {}
): Promise<SocialMediaResult> {
  const start = Date.now();
  const platforms = options.platforms || ["reddit", "hackernews", "github"];
  const limit = options.limit || 15;
  const allPosts: SocialPost[] = [];
  const platformCounts: Record<string, number> = {};

  // Reddit
  if (platforms.includes("reddit")) {
    const redditPosts = await searchReddit(query, { limit });
    allPosts.push(...redditPosts);
    platformCounts["Reddit"] = redditPosts.length;

    // Also search specific subreddits
    for (const sub of (options.subreddits || [])) {
      const subPosts = await searchReddit(query, { subreddit: sub, limit: 10 });
      allPosts.push(...subPosts);
      platformCounts[`r/${sub}`] = subPosts.length;
    }
  }

  // Hacker News
  if (platforms.includes("hackernews")) {
    const hnPosts = await searchHackerNews(query, { limit });
    allPosts.push(...hnPosts);
    platformCounts["Hacker News"] = hnPosts.length;
  }

  // Telegram
  if (platforms.includes("telegram") && options.telegramChannels?.length) {
    for (const channel of options.telegramChannels) {
      const tgPosts = await scrapeTelegramChannel(channel, 10);
      // Filter by query
      const matching = tgPosts.filter(p => p.content.toLowerCase().includes(query.toLowerCase()));
      allPosts.push(...matching);
      platformCounts[`TG:${channel}`] = matching.length;
    }
  }

  // GitHub
  if (platforms.includes("github")) {
    const ghPosts = await searchGithubDiscussions(query, limit);
    allPosts.push(...ghPosts);
    platformCounts["GitHub"] = ghPosts.length;
  }

  // StackOverflow
  if (platforms.includes("stackoverflow")) {
    const soPosts = await searchStackOverflow(query, limit);
    allPosts.push(...soPosts);
    platformCounts["StackOverflow"] = soPosts.length;
  }

  // Sort by date
  allPosts.sort((a, b) => {
    const da = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const db = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return db - da;
  });

  return {
    query,
    posts: allPosts,
    platforms: Object.entries(platformCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    stats: {
      totalPosts: allPosts.length,
      platformsQueried: Object.keys(platformCounts).length,
      durationMs: Date.now() - start,
    },
    timestamp: new Date().toISOString(),
  };
}
