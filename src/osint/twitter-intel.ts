/**
 * Twitter/X Intelligence — public tweet collection and sentiment analysis
 * No API key needed — uses Twitter Syndication API, search engines, RSS bridges
 *
 * Methods:
 * 1. Twitter Syndication API (embed endpoint — public profiles)
 * 2. DuckDuckGo site:x.com search (keyword monitoring)
 * 3. RSS bridges (RSSHub, Nitter mirrors)
 * 4. Google cache for deleted tweets
 */

export interface Tweet {
  id?: string;
  author: string;
  handle?: string;
  content: string;
  timestamp?: string;
  likes?: number;
  retweets?: number;
  replies?: number;
  url?: string;
  media?: string[];
  isRetweet?: boolean;
  language?: string;
  source: string;
}

export interface TwitterProfileResult {
  handle: string;
  name?: string;
  bio?: string;
  followers?: number;
  following?: number;
  tweets?: number;
  verified?: boolean;
  joinDate?: string;
  location?: string;
  website?: string;
  recentTweets: Tweet[];
  source: string;
  timestamp: string;
}

export interface TwitterSearchResult {
  query: string;
  tweets: Tweet[];
  sentiment?: {
    positive: number;
    negative: number;
    neutral: number;
    averageScore: number;
  };
  topHashtags: { tag: string; count: number }[];
  topMentions: { user: string; count: number }[];
  timelineDistribution: { date: string; count: number; avgSentiment: number }[];
  stats: {
    totalTweets: number;
    sourcesQueried: number;
    durationMs: number;
  };
  timestamp: string;
}

// ── Twitter Syndication API (embed data — free) ─────────
// This is the same API Twitter uses for embedded tweets on websites

async function fetchFromSyndication(handle: string): Promise<TwitterProfileResult> {
  const clean = handle.replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "");
  const result: TwitterProfileResult = {
    handle: clean, recentTweets: [], source: "syndication", timestamp: new Date().toISOString(),
  };

  try {
    // Twitter syndication timeline endpoint
    const response = await fetch(
      `https://syndication.twitter.com/srv/timeline-profile/screen-name/${clean}`,
      {
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html",
        },
      }
    );

    if (!response.ok) return result;
    const html = await response.text();

    // Extract profile info from embedded data
    const nameMatch = html.match(/<div[^>]*class="[^"]*TimelineProfileHeader-displayName[^"]*"[^>]*>([^<]+)/i);
    if (nameMatch) result.name = nameMatch[1].trim();

    const bioMatch = html.match(/<p[^>]*class="[^"]*TimelineProfileHeader-bio[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    if (bioMatch) result.bio = bioMatch[1].replace(/<[^>]+>/g, "").trim();

    // Extract tweets from timeline
    const tweetBlocks = html.matchAll(/<div[^>]*class="[^"]*timeline-Tweet[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi);
    for (const block of tweetBlocks) {
      const content = block[1];

      const textMatch = content.match(/<p[^>]*class="[^"]*timeline-Tweet-text[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
      const timeMatch = content.match(/<time[^>]*datetime="([^"]+)"/i);
      const likesMatch = content.match(/like[^>]*>(\d+)/i);
      const retweetsMatch = content.match(/retweet[^>]*>(\d+)/i);

      if (textMatch) {
        const text = textMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (text.length > 5) {
          result.recentTweets.push({
            author: result.name || clean,
            handle: clean,
            content: text,
            timestamp: timeMatch?.[1],
            likes: likesMatch ? parseInt(likesMatch[1]) : undefined,
            retweets: retweetsMatch ? parseInt(retweetsMatch[1]) : undefined,
            url: `https://x.com/${clean}`,
            source: "syndication",
          });
        }
      }
    }

    // Try JSON data embedded in page
    const jsonMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i) ||
                      html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        // Extract from Next.js data structure
        const timeline = data?.props?.pageProps?.timeline;
        if (timeline?.entries) {
          for (const entry of timeline.entries.slice(0, 20)) {
            const tweet = entry?.content?.tweet;
            if (tweet) {
              result.recentTweets.push({
                id: tweet.id_str,
                author: tweet.user?.name || clean,
                handle: tweet.user?.screen_name || clean,
                content: tweet.full_text || tweet.text || "",
                timestamp: tweet.created_at,
                likes: tweet.favorite_count,
                retweets: tweet.retweet_count,
                replies: tweet.reply_count,
                url: `https://x.com/${clean}/status/${tweet.id_str}`,
                isRetweet: !!tweet.retweeted_status,
                source: "syndication-json",
              });
            }
          }
        }
      } catch {}
    }
  } catch {}

  return result;
}

// ── Search Engine Twitter Scraping ──────────────────────

async function searchTweetsViaEngine(query: string): Promise<Tweet[]> {
  const tweets: Tweet[] = [];

  // DuckDuckGo: search for tweets
  try {
    const searchQuery = `site:x.com "${query}"`;
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`,
      {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      }
    );

    if (response.ok) {
      const html = await response.text();

      // Extract all x.com/twitter.com status URLs
      const tweetUrls = html.matchAll(/(?:x\.com|twitter\.com)\/(\w+)\/status\/(\d+)/g);
      const seenIds = new Set<string>();

      for (const urlMatch of tweetUrls) {
        const handle = urlMatch[1];
        const tweetId = urlMatch[2];
        if (seenIds.has(tweetId) || handle === "i" || handle === "intent") continue;
        seenIds.add(tweetId);

        // Find the surrounding snippet for this URL
        const snippetMatch = html.match(new RegExp(`class="result__snippet"[^>]*>([\\s\\S]*?)<\\/a>`, "i"));
        const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").trim() : "";

        tweets.push({
          id: tweetId,
          author: handle,
          handle,
          content: snippet || `Tweet by @${handle}`,
          url: `https://x.com/${handle}/status/${tweetId}`,
          source: "search-engine",
        });
      }

      // Also extract snippets that mention the query from non-URL results
      const snippets = html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi);
      for (const s of snippets) {
        const text = s[1].replace(/<[^>]+>/g, "").trim();
        if (text.length > 20 && text.toLowerCase().includes(query.toLowerCase().slice(0, 10))) {
          // Check if there's a handle in the nearby content
          const handleNearby = s[0].match(/@(\w{1,15})/);
          if (handleNearby && !tweets.find(t => t.content === text)) {
            tweets.push({
              author: handleNearby[1],
              handle: handleNearby[1],
              content: text,
              source: "search-engine-snippet",
            });
          }
        }
      }
    }
  } catch {}

  // Also try Bing for more coverage
  try {
    const response = await fetch(
      `https://www.bing.com/search?q=${encodeURIComponent(`site:x.com "${query}"`)}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      }
    );
    if (response.ok) {
      const html = await response.text();
      const bingUrls = html.matchAll(/(?:x\.com|twitter\.com)\/(\w+)\/status\/(\d+)/g);
      for (const m of bingUrls) {
        if (!tweets.find(t => t.id === m[2]) && m[1] !== "i") {
          tweets.push({
            id: m[2], author: m[1], handle: m[1],
            content: `Tweet by @${m[1]}`,
            url: `https://x.com/${m[1]}/status/${m[2]}`,
            source: "bing",
          });
        }
      }
    }
  } catch {}

  return tweets;
}

// ── RSS Bridge (RSSHub — free) ──────────────────────────

async function fetchFromRssBridge(handle: string): Promise<Tweet[]> {
  const tweets: Tweet[] = [];
  const clean = handle.replace(/^@/, "");

  // Try RSSHub (public instance)
  const bridges = [
    `https://rsshub.app/twitter/user/${clean}`,
    `https://rss.app/feeds/v1.1/twitter/${clean}`,
  ];

  for (const bridgeUrl of bridges) {
    try {
      const response = await fetch(bridgeUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Panopticon-OSINT/1.0" },
      });
      if (!response.ok) continue;

      const xml = await response.text();

      // Parse RSS items
      const items = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
      for (const item of items) {
        const block = item[1];
        const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim();
        const link = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim();
        const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim();
        const desc = block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1]?.trim();

        const content = (desc || title || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (content.length > 10) {
          tweets.push({
            author: clean,
            handle: clean,
            content,
            timestamp: pubDate ? new Date(pubDate).toISOString() : undefined,
            url: link || `https://x.com/${clean}`,
            source: "rss-bridge",
          });
        }
      }

      if (tweets.length > 0) break; // Got results, stop trying bridges
    } catch {}
  }

  return tweets;
}

// ── Extract hashtags and mentions ────────────────────────

function extractHashtags(tweets: Tweet[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const tweet of tweets) {
    const tags = tweet.content.match(/#\w+/g) || [];
    for (const tag of tags) {
      const lower = tag.toLowerCase();
      counts.set(lower, (counts.get(lower) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

function extractMentions(tweets: Tweet[]): { user: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const tweet of tweets) {
    const mentions = tweet.content.match(/@\w+/g) || [];
    for (const mention of mentions) {
      const lower = mention.toLowerCase();
      counts.set(lower, (counts.get(lower) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([user, count]) => ({ user, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

// ── Build timeline distribution ─────────────────────────

function buildTimeline(tweets: Tweet[], sentimentScores: Map<string, number>): TwitterSearchResult["timelineDistribution"] {
  const byDate = new Map<string, { count: number; totalSentiment: number }>();

  for (const tweet of tweets) {
    if (!tweet.timestamp) continue;
    const date = tweet.timestamp.split("T")[0];
    const entry = byDate.get(date) || { count: 0, totalSentiment: 0 };
    entry.count++;
    entry.totalSentiment += sentimentScores.get(tweet.content) || 0;
    byDate.set(date, entry);
  }

  return Array.from(byDate.entries())
    .map(([date, { count, totalSentiment }]) => ({
      date,
      count,
      avgSentiment: Math.round((totalSentiment / count) * 1000) / 1000,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Get Twitter Profile ─────────────────────────────────

export async function getTwitterProfile(handle: string): Promise<TwitterProfileResult> {
  // Try syndication first
  const profile = await fetchFromSyndication(handle);

  // If no tweets from syndication, try RSS bridges
  if (profile.recentTweets.length === 0) {
    const rssTweets = await fetchFromRssBridge(handle);
    profile.recentTweets.push(...rssTweets);
    if (rssTweets.length > 0) profile.source = "rss-bridge";
  }

  // If still no tweets, try search engine
  if (profile.recentTweets.length === 0) {
    const searchTweets = await searchTweetsViaEngine(`from:${handle.replace(/^@/, "")}`);
    profile.recentTweets.push(...searchTweets);
    if (searchTweets.length > 0) profile.source = "search-engine";
  }

  return profile;
}

// ── Search Twitter by Keyword ───────────────────────────

export async function searchTwitter(query: string, options: {
  handles?: string[];     // Specific accounts to monitor
  includeSearch?: boolean; // Search engine results
  sentiment?: boolean;     // Run sentiment analysis
} = {}): Promise<TwitterSearchResult> {
  const start = Date.now();
  const allTweets: Tweet[] = [];
  let sourcesQueried = 0;

  // Search via search engine
  if (options.includeSearch !== false) {
    const searchResults = await searchTweetsViaEngine(query);
    allTweets.push(...searchResults);
    sourcesQueried++;
  }

  // Monitor specific handles
  if (options.handles?.length) {
    for (const handle of options.handles) {
      const profile = await getTwitterProfile(handle);
      // Filter tweets by query keyword
      const matching = profile.recentTweets.filter(t =>
        t.content.toLowerCase().includes(query.toLowerCase())
      );
      allTweets.push(...matching);
      sourcesQueried++;
    }
  }

  // Deduplicate by content similarity
  const seen = new Set<string>();
  const unique = allTweets.filter(t => {
    const key = t.content.slice(0, 50).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sentiment analysis
  let sentiment: TwitterSearchResult["sentiment"];
  const sentimentScores = new Map<string, number>();

  if (options.sentiment !== false) {
    try {
      const { analyzeSentiment } = await import("./sentiment.js");
      let posCount = 0, negCount = 0, neutralCount = 0, totalScore = 0;

      for (const tweet of unique) {
        const s = analyzeSentiment(tweet.content);
        sentimentScores.set(tweet.content, s.comparative);
        totalScore += s.comparative;
        if (s.label.includes("positive")) posCount++;
        else if (s.label.includes("negative")) negCount++;
        else neutralCount++;
      }

      sentiment = {
        positive: posCount,
        negative: negCount,
        neutral: neutralCount,
        averageScore: unique.length > 0 ? Math.round((totalScore / unique.length) * 1000) / 1000 : 0,
      };
    } catch {}
  }

  const topHashtags = extractHashtags(unique);
  const topMentions = extractMentions(unique);
  const timelineDistribution = buildTimeline(unique, sentimentScores);

  return {
    query,
    tweets: unique,
    sentiment,
    topHashtags,
    topMentions,
    timelineDistribution,
    stats: {
      totalTweets: unique.length,
      sourcesQueried,
      durationMs: Date.now() - start,
    },
    timestamp: new Date().toISOString(),
  };
}

// ── Full Twitter OSINT (profile + keyword + sentiment) ──

export async function twitterIntel(
  target: string,
  options: { keywords?: string[]; depth?: "quick" | "deep" } = {}
): Promise<{
  profile?: TwitterProfileResult;
  keywordResults: TwitterSearchResult[];
  overallSentiment: { score: number; label: string };
  timestamp: string;
}> {
  const isHandle = target.startsWith("@") || /^[a-zA-Z0-9_]{1,15}$/.test(target);
  const keywords = options.keywords || [target];

  // Profile
  let profile: TwitterProfileResult | undefined;
  if (isHandle) {
    profile = await getTwitterProfile(target);
  }

  // Keyword search
  const keywordResults: TwitterSearchResult[] = [];
  for (const kw of keywords) {
    const result = await searchTwitter(kw, {
      handles: isHandle ? [target] : undefined,
      sentiment: true,
    });
    keywordResults.push(result);
  }

  // Overall sentiment
  let totalScore = 0, totalCount = 0;
  for (const kr of keywordResults) {
    if (kr.sentiment) {
      totalScore += kr.sentiment.averageScore * kr.stats.totalTweets;
      totalCount += kr.stats.totalTweets;
    }
  }
  const avgScore = totalCount > 0 ? totalScore / totalCount : 0;

  return {
    profile,
    keywordResults,
    overallSentiment: {
      score: Math.round(avgScore * 1000) / 1000,
      label: avgScore > 0.1 ? "positive" : avgScore < -0.1 ? "negative" : "neutral",
    },
    timestamp: new Date().toISOString(),
  };
}
