/**
 * Media Collector — YouTube subtitles, official blogs, Reddit full posts, Telegram channels
 * Deep content extraction from free sources that news paywalls can't block
 */

// ── YouTube Transcript Extraction ───────────────────────

export interface YouTubeVideo {
  videoId: string;
  title: string;
  author: string;
  transcript?: string;
  duration?: string;
  views?: string;
  publishDate?: string;
  description?: string;
  url: string;
}

export interface YouTubeSearchResult {
  query: string;
  videos: YouTubeVideo[];
  stats: { total: number; withTranscript: number };
  timestamp: string;
}

export async function getYouTubeTranscript(videoId: string): Promise<YouTubeVideo> {
  const result: YouTubeVideo = {
    videoId,
    title: "",
    author: "",
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };

  // Step 1: Get video info via oEmbed (free, no key)
  try {
    const oembed = await fetch(
      `https://www.youtube.com/oembed?url=https://youtube.com/watch?v=${videoId}&format=json`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (oembed.ok) {
      const data = await oembed.json();
      result.title = data.title || "";
      result.author = data.author_name || "";
    }
  } catch {}

  // Step 2: Get caption track URL from page
  try {
    const page = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });
    const html = await page.text();

    // Extract description
    const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    if (descMatch) result.description = descMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').slice(0, 500);

    // Extract view count
    const viewMatch = html.match(/"viewCount":"(\d+)"/);
    if (viewMatch) result.views = parseInt(viewMatch[1]).toLocaleString();

    // Extract publish date
    const dateMatch = html.match(/"publishDate":"([^"]+)"/);
    if (dateMatch) result.publishDate = dateMatch[1];

    // Extract caption tracks
    const captionMatch = html.match(/"captionTracks":\[(.*?)\]/);
    if (captionMatch) {
      const baseUrlMatch = captionMatch[1].match(/"baseUrl":"([^"]+)"/);
      if (baseUrlMatch) {
        const captionUrl = baseUrlMatch[1].replace(/\\u0026/g, "&");

        // Fetch the actual transcript
        const captionResp = await fetch(captionUrl, { signal: AbortSignal.timeout(10000) });
        if (captionResp.ok) {
          const captionXml = await captionResp.text();

          // Parse XML subtitle entries
          const texts: string[] = [];
          const entries = captionXml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/gi);
          for (const entry of entries) {
            const text = entry[1]
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/<[^>]+>/g, "")
              .trim();
            if (text) texts.push(text);
          }

          result.transcript = texts.join(" ");
        }
      }
    }
  } catch {}

  return result;
}

export async function searchYouTube(query: string, limit = 5): Promise<YouTubeSearchResult> {
  const videos: YouTubeVideo[] = [];

  // Search via YouTube search page scraping
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) {
      const html = await response.text();

      // Extract video IDs from search results
      const videoIds = new Set<string>();
      const idMatches = html.matchAll(/\/watch\?v=([a-zA-Z0-9_-]{11})/g);
      for (const m of idMatches) {
        if (videoIds.size >= limit) break;
        videoIds.add(m[1]);
      }

      // Get transcript for each video
      for (const vid of videoIds) {
        const video = await getYouTubeTranscript(vid);
        if (video.title) videos.push(video);
      }
    }
  } catch {}

  return {
    query,
    videos,
    stats: {
      total: videos.length,
      withTranscript: videos.filter(v => v.transcript && v.transcript.length > 50).length,
    },
    timestamp: new Date().toISOString(),
  };
}

// ── Official Blog Monitor ───────────────────────────────

export interface BlogPost {
  title: string;
  url: string;
  date?: string;
  content: string;
  author?: string;
  source: string;
}

export interface BlogMonitorResult {
  sources: string[];
  posts: BlogPost[];
  stats: { total: number; sourcesChecked: number };
  timestamp: string;
}

const OFFICIAL_BLOGS: { name: string; rssUrl?: string; pageUrl: string }[] = [
  // AI Companies
  { name: "OpenAI Blog", pageUrl: "https://openai.com/blog", rssUrl: "https://openai.com/blog/rss.xml" },
  { name: "Anthropic Blog", pageUrl: "https://www.anthropic.com/research", rssUrl: "https://www.anthropic.com/rss.xml" },
  { name: "Google AI Blog", pageUrl: "https://blog.google/technology/ai/", rssUrl: "https://blog.google/technology/ai/rss/" },
  { name: "Meta AI", pageUrl: "https://ai.meta.com/blog/", rssUrl: "https://ai.meta.com/blog/rss/" },
  { name: "Microsoft AI Blog", pageUrl: "https://blogs.microsoft.com/ai/", rssUrl: "https://blogs.microsoft.com/ai/feed/" },
  { name: "DeepMind Blog", pageUrl: "https://deepmind.google/discover/blog/" },

  // Security
  { name: "Google Project Zero", pageUrl: "https://googleprojectzero.blogspot.com/", rssUrl: "https://googleprojectzero.blogspot.com/feeds/posts/default?alt=rss" },
  { name: "Cloudflare Blog", pageUrl: "https://blog.cloudflare.com/", rssUrl: "https://blog.cloudflare.com/rss/" },

  // Government
  { name: "White House Briefings", pageUrl: "https://www.whitehouse.gov/briefing-room/", rssUrl: "https://www.whitehouse.gov/briefing-room/feed/" },
  { name: "CISA Alerts", pageUrl: "https://www.cisa.gov/news-events/cybersecurity-advisories", rssUrl: "https://www.cisa.gov/cybersecurity-advisories/all.xml" },
];

async function fetchBlogRss(blog: { name: string; rssUrl?: string; pageUrl: string }): Promise<BlogPost[]> {
  const posts: BlogPost[] = [];

  // Try RSS first
  if (blog.rssUrl) {
    try {
      const response = await fetch(blog.rssUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Panopticon/1.0" },
      });
      if (response.ok) {
        const xml = await response.text();

        // Parse RSS items
        const items = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
        for (const item of items) {
          const block = item[1];
          const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] || "").replace(/<[^>]+>/g, "").trim();
          const link = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() || "";
          const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim();
          const desc = (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          const author = block.match(/<dc:creator>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/dc:creator>/i)?.[1]?.trim();

          if (title) {
            posts.push({
              title,
              url: link,
              date: pubDate,
              content: desc.slice(0, 1000),
              author,
              source: blog.name,
            });
          }
        }

        // Also try Atom entries
        if (posts.length === 0) {
          const entries = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi);
          for (const entry of entries) {
            const block = entry[1];
            const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
            const link = block.match(/<link[^>]*href="([^"]+)"/i)?.[1] || "";
            const updated = block.match(/<(?:updated|published)>([\s\S]*?)<\/(?:updated|published)>/i)?.[1]?.trim();
            const summary = (block.match(/<(?:summary|content)[^>]*>([\s\S]*?)<\/(?:summary|content)>/i)?.[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

            if (title) posts.push({ title, url: link, date: updated, content: summary.slice(0, 1000), source: blog.name });
          }
        }
      }
    } catch {}
  }

  return posts.slice(0, 10);
}

export async function monitorOfficialBlogs(filter?: string[]): Promise<BlogMonitorResult> {
  const blogs = filter
    ? OFFICIAL_BLOGS.filter(b => filter.some(f => b.name.toLowerCase().includes(f.toLowerCase())))
    : OFFICIAL_BLOGS;

  const allPosts: BlogPost[] = [];
  let sourcesChecked = 0;

  // Fetch in parallel (batches of 3)
  for (let i = 0; i < blogs.length; i += 3) {
    const batch = blogs.slice(i, i + 3);
    const results = await Promise.all(batch.map(fetchBlogRss));
    for (const posts of results) {
      allPosts.push(...posts);
      sourcesChecked++;
    }
  }

  // Sort by date (newest first)
  allPosts.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  return {
    sources: blogs.map(b => b.name),
    posts: allPosts,
    stats: { total: allPosts.length, sourcesChecked },
    timestamp: new Date().toISOString(),
  };
}

// ── Reddit Deep Content (full posts + comments) ─────────

export interface RedditThread {
  title: string;
  author: string;
  selftext: string;       // Full post content
  url: string;
  score: number;
  numComments: number;
  subreddit: string;
  created: string;
  topComments: RedditComment[];
}

export interface RedditComment {
  author: string;
  body: string;
  score: number;
  created: string;
}

export async function getRedditThread(url: string): Promise<RedditThread | null> {
  try {
    // Append .json to Reddit URL
    const jsonUrl = url.replace(/\/$/, "") + ".json";
    const response = await fetch(jsonUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Panopticon/1.0 OSINT Research" },
    });
    if (!response.ok) return null;
    const data = await response.json();

    const post = data[0]?.data?.children?.[0]?.data;
    if (!post) return null;

    // Get top comments
    const topComments: RedditComment[] = [];
    for (const child of (data[1]?.data?.children || []).slice(0, 10)) {
      const c = child.data;
      if (c && c.body && c.author !== "AutoModerator") {
        topComments.push({
          author: c.author || "[deleted]",
          body: c.body.slice(0, 500),
          score: c.score || 0,
          created: c.created_utc ? new Date(c.created_utc * 1000).toISOString() : "",
        });
      }
    }

    return {
      title: post.title || "",
      author: post.author || "[deleted]",
      selftext: post.selftext?.slice(0, 3000) || "",
      url: `https://www.reddit.com${post.permalink}`,
      score: post.score || 0,
      numComments: post.num_comments || 0,
      subreddit: post.subreddit || "",
      created: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : "",
      topComments,
    };
  } catch {
    return null;
  }
}

export async function searchRedditDeep(query: string, options: { subreddit?: string; limit?: number } = {}): Promise<RedditThread[]> {
  const threads: RedditThread[] = [];
  const limit = options.limit || 5;

  try {
    const baseUrl = options.subreddit
      ? `https://www.reddit.com/r/${options.subreddit}/search.json`
      : "https://www.reddit.com/search.json";

    const response = await fetch(
      `${baseUrl}?q=${encodeURIComponent(query)}&sort=relevance&limit=${limit}&restrict_sr=${options.subreddit ? "true" : "false"}`,
      {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Panopticon/1.0 OSINT Research" },
      }
    );
    if (!response.ok) return threads;
    const data = await response.json();

    for (const child of (data.data?.children || [])) {
      const post = child.data;
      if (!post) continue;

      threads.push({
        title: post.title || "",
        author: post.author || "[deleted]",
        selftext: post.selftext?.slice(0, 2000) || "",
        url: `https://www.reddit.com${post.permalink}`,
        score: post.score || 0,
        numComments: post.num_comments || 0,
        subreddit: post.subreddit || "",
        created: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : "",
        topComments: [], // Would need separate fetch per thread
      });
    }
  } catch {}

  return threads;
}

// ── Telegram Channel Deep Scrape ────────────────────────

export interface TelegramMessage {
  text: string;
  date?: string;
  views?: string;
  mediaType?: string;  // photo, video, document
  forwardFrom?: string;
}

export interface TelegramChannelResult {
  channel: string;
  description?: string;
  messages: TelegramMessage[];
  stats: { total: number };
  timestamp: string;
}

export async function scrapeTelegramChannelDeep(channel: string, limit = 30): Promise<TelegramChannelResult> {
  const clean = channel.replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "");
  const result: TelegramChannelResult = {
    channel: clean,
    messages: [],
    stats: { total: 0 },
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(`https://t.me/s/${clean}`, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!response.ok) return result;
    const html = await response.text();

    // Extract channel description
    const descMatch = html.match(/<div class="tgme_channel_info_description">([\s\S]*?)<\/div>/i);
    if (descMatch) result.description = descMatch[1].replace(/<[^>]+>/g, "").trim();

    // Extract messages
    const messageBlocks = html.matchAll(/<div class="tgme_widget_message_wrap[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/gi);

    for (const block of messageBlocks) {
      const content = block[0];

      // Message text
      const textMatch = content.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const text = textMatch ? textMatch[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim() : "";

      // Date
      const dateMatch = content.match(/<time[^>]*datetime="([^"]+)"/i);

      // Views
      const viewsMatch = content.match(/<span class="tgme_widget_message_views"[^>]*>([^<]+)/i);

      // Media
      const hasPhoto = content.includes("tgme_widget_message_photo");
      const hasVideo = content.includes("tgme_widget_message_video");

      // Forward source
      const fwdMatch = content.match(/tgme_widget_message_forwarded_from_name[^>]*>([^<]+)/i);

      if (text.length > 5) {
        result.messages.push({
          text: text.slice(0, 1000),
          date: dateMatch?.[1],
          views: viewsMatch?.[1]?.trim(),
          mediaType: hasVideo ? "video" : hasPhoto ? "photo" : undefined,
          forwardFrom: fwdMatch?.[1]?.trim(),
        });
      }

      if (result.messages.length >= limit) break;
    }

    result.stats.total = result.messages.length;
  } catch {}

  return result;
}
