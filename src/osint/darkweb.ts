/**
 * Dark Web Intelligence — check for .onion presence via public indexes
 * No Tor connection needed — queries public dark web search engines and indexes
 */

export interface DarkWebResult {
  query: string;
  mentions: DarkWebMention[];
  onionUrls: string[];
  relatedLeaks: string[];
  timestamp: string;
}

export interface DarkWebMention {
  source: string;
  title: string;
  url: string;
  snippet: string;
  type: "forum" | "marketplace" | "paste" | "leak" | "service" | "unknown";
}

// ── Public Dark Web Indexes (no Tor needed) ─────────────

export async function searchDarkWebIndexes(query: string): Promise<DarkWebResult> {
  const mentions: DarkWebMention[] = [];
  const onionUrls: string[] = [];
  const relatedLeaks: string[] = [];
  const clean = query.replace(/[^a-zA-Z0-9.\-@_ ]/g, "");

  // Source 1: Ahmia.fi (Tor search engine with clearnet interface — free)
  try {
    const response = await fetch(
      `https://ahmia.fi/search/?q=${encodeURIComponent(clean)}`,
      {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OSINT-Agent/1.0)" },
      }
    );
    if (response.ok) {
      const html = await response.text();
      const results = html.matchAll(/<li class="result">([\s\S]*?)<\/li>/gi);
      for (const match of results) {
        const block = match[1];
        const urlMatch = block.match(/href="(https?:\/\/[^"]+)"/);
        const titleMatch = block.match(/<a[^>]*>([\s\S]*?)<\/a>/);
        const snippetMatch = block.match(/<p>([\s\S]*?)<\/p>/);
        const onionMatch = block.match(/([a-z2-7]{56}\.onion|[a-z2-7]{16}\.onion)/i);

        if (urlMatch || onionMatch) {
          mentions.push({
            source: "Ahmia.fi",
            title: (titleMatch?.[1] || "").replace(/<[^>]+>/g, "").trim().slice(0, 100),
            url: urlMatch?.[1] || "",
            snippet: (snippetMatch?.[1] || "").replace(/<[^>]+>/g, "").trim().slice(0, 200),
            type: "unknown",
          });
          if (onionMatch) onionUrls.push(onionMatch[1]);
        }
      }
    }
  } catch {}

  // Source 2: IntelX (Intelligence X — public search, limited free)
  try {
    const response = await fetch(
      `https://2600.shodan.io/search?query=${encodeURIComponent(clean)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    // Note: Shodan 2600 may not always be available
  } catch {}

  // Source 3: Check for known .onion patterns in DNS TXT records
  try {
    const { execFileNoThrow } = await import("../utils/execFileNoThrow.js");
    const { stdout } = await execFileNoThrow("dig", ["+short", clean, "TXT"], { timeoutMs: 5000 });
    const onionMatches = stdout.match(/[a-z2-7]{56}\.onion/gi) || [];
    onionUrls.push(...onionMatches);
  } catch {}

  // Source 4: Check paste sites for mentions
  try {
    const response = await fetch(
      `https://psbdmp.ws/api/v3/search/${encodeURIComponent(clean)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        for (const paste of data.slice(0, 10)) {
          mentions.push({
            source: "Pastebin Dump",
            title: paste.id || "Paste",
            url: `https://pastebin.com/${paste.id}`,
            snippet: (paste.text || "").slice(0, 200),
            type: "paste",
          });
        }
      }
    }
  } catch {}

  return {
    query: clean,
    mentions: mentions.slice(0, 20),
    onionUrls: [...new Set(onionUrls)],
    relatedLeaks,
    timestamp: new Date().toISOString(),
  };
}
