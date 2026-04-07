/**
 * Sentiment Analysis & Opinion Mining — local NLP, no API needed
 * AFINN-based scoring + entity extraction + trend analysis
 */

export interface SentimentResult {
  text: string;
  score: number;         // -5 to +5
  comparative: number;   // score / word count
  label: "very_negative" | "negative" | "neutral" | "positive" | "very_positive";
  positive: string[];
  negative: string[];
  entities: ExtractedEntity[];
}

export interface ExtractedEntity {
  text: string;
  type: "person" | "organization" | "location" | "technology" | "money" | "date" | "url" | "email";
  count: number;
}

export interface OpinionAnalysis {
  query: string;
  totalPosts: number;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  averageScore: number;
  topPositive: { text: string; score: number }[];
  topNegative: { text: string; score: number }[];
  entities: ExtractedEntity[];
  keywords: { word: string; count: number; sentiment: number }[];
  timeline?: { date: string; avgScore: number; count: number }[];
  timestamp: string;
}

// ── AFINN-165 Lexicon (subset — most impactful words) ───

const AFINN: Record<string, number> = {
  // Very positive (+4 to +5)
  outstanding: 5, superb: 5, breathtaking: 5, excellent: 4, amazing: 4, awesome: 4, fantastic: 4, incredible: 4,
  wonderful: 4, brilliant: 4, exceptional: 4, magnificent: 4, remarkable: 4, love: 3, great: 3, perfect: 3,

  // Positive (+1 to +3)
  good: 3, best: 3, beautiful: 3, happy: 3, exciting: 3, impressive: 3, innovative: 3, successful: 3,
  enjoy: 2, nice: 2, positive: 2, strong: 2, win: 2, growth: 2, improve: 2, support: 2, agree: 2,
  benefit: 2, like: 2, recommend: 2, profit: 2, gain: 2, advance: 2, progress: 2, opportunity: 2,
  effective: 2, efficient: 2, reliable: 2, stable: 2, secure: 2, safe: 1, ok: 1, fine: 1, correct: 1,
  useful: 1, interesting: 1, hope: 1, fair: 1, popular: 1, rising: 1, upgrade: 1, recover: 1,
  surge: 2, rally: 2, boom: 2, soar: 2, bullish: 2, outperform: 2, beat: 1,

  // Negative (-1 to -3)
  bad: -3, terrible: -3, awful: -3, horrible: -3, hate: -3, worst: -3, ugly: -3, disgusting: -3,
  poor: -2, wrong: -2, fail: -2, failure: -2, problem: -2, issue: -2, concern: -2, risk: -2,
  loss: -2, decline: -2, drop: -2, fall: -2, crash: -2, crisis: -2, threat: -2, danger: -2,
  slow: -1, difficult: -1, hard: -1, weak: -1, negative: -1, sad: -1, sorry: -1, miss: -1,
  lack: -1, delay: -1, deny: -1, reject: -1, cut: -1, reduce: -1, lose: -1, against: -1,
  bearish: -2, downgrade: -2, slump: -2, plunge: -2, tumble: -2, selloff: -2, deficit: -2,
  recession: -3, bankrupt: -3, fraud: -3, scandal: -3, lawsuit: -3, penalty: -2,

  // Very negative (-4 to -5)
  catastrophe: -4, disaster: -4, devastating: -4, destroy: -4, collapse: -4,
  attack: -3, kill: -3, death: -3, war: -3, terror: -4, bomb: -4, murder: -4,
  hack: -2, breach: -2, exploit: -3, malware: -3, ransomware: -3, vulnerability: -2,
};

// ── Chinese Sentiment Lexicon ───────────────────────────

const AFINN_ZH: Record<string, number> = {
  // Positive
  "好": 2, "优秀": 3, "出色": 3, "成功": 3, "增长": 2, "上涨": 2, "利好": 2,
  "突破": 2, "创新": 2, "领先": 2, "稳定": 1, "改善": 2, "提升": 2, "盈利": 2,
  "反弹": 1, "强劲": 2, "看好": 2, "推荐": 2, "合作": 1, "发展": 1,
  // Negative
  "差": -2, "失败": -3, "下跌": -2, "暴跌": -3, "亏损": -3, "危机": -3,
  "风险": -2, "问题": -2, "担忧": -2, "警告": -2, "崩盘": -4, "违规": -3,
  "处罚": -2, "罚款": -2, "诈骗": -4, "泄露": -2, "攻击": -3, "漏洞": -2,
  "裁员": -2, "破产": -4, "造假": -4, "丑闻": -3, "调查": -1, "诉讼": -2,
};

// ── Sentiment Analysis ──────────────────────────────────

export function analyzeSentiment(text: string): SentimentResult {
  const words = text.toLowerCase().replace(/[^\w\s\u4e00-\u9fff]/g, " ").split(/\s+/).filter(Boolean);
  let score = 0;
  const positive: string[] = [];
  const negative: string[] = [];

  for (const word of words) {
    const s = AFINN[word] ?? AFINN_ZH[word] ?? 0;
    if (s > 0) positive.push(word);
    if (s < 0) negative.push(word);
    score += s;
  }

  // Check for Chinese characters
  const zhChars = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const phrase of zhChars) {
    for (const [term, s] of Object.entries(AFINN_ZH)) {
      if (phrase.includes(term)) {
        score += s;
        if (s > 0) positive.push(term);
        if (s < 0) negative.push(term);
      }
    }
  }

  // Negation handling (simple)
  const negationWords = ["not", "no", "never", "don't", "doesn't", "didn't", "won't", "can't", "isn't", "aren't",
    "不", "没", "未", "无", "非", "别"];
  for (let i = 0; i < words.length - 1; i++) {
    if (negationWords.includes(words[i])) {
      const nextScore = AFINN[words[i + 1]] ?? AFINN_ZH[words[i + 1]] ?? 0;
      score -= nextScore * 2; // Negate and reverse
    }
  }

  const comparative = words.length > 0 ? score / words.length : 0;

  let label: SentimentResult["label"];
  if (comparative > 0.5) label = "very_positive";
  else if (comparative > 0.1) label = "positive";
  else if (comparative < -0.5) label = "very_negative";
  else if (comparative < -0.1) label = "negative";
  else label = "neutral";

  return {
    text: text.slice(0, 200),
    score,
    comparative: Math.round(comparative * 1000) / 1000,
    label,
    positive: [...new Set(positive)],
    negative: [...new Set(negative)],
    entities: extractEntities(text),
  };
}

// ── Entity Extraction ───────────────────────────────────

export function extractEntities(text: string): ExtractedEntity[] {
  const entities: Map<string, ExtractedEntity> = new Map();

  const patterns: { regex: RegExp; type: ExtractedEntity["type"] }[] = [
    // Money amounts
    { regex: /\$[\d,]+(?:\.\d+)?(?:\s*(?:million|billion|trillion|M|B|T))?/gi, type: "money" },
    { regex: /[\d,]+(?:\.\d+)?\s*(?:美元|人民币|亿|万)/g, type: "money" },
    { regex: /€[\d,]+(?:\.\d+)?/g, type: "money" },

    // URLs
    { regex: /https?:\/\/[^\s<>"]+/g, type: "url" },

    // Emails
    { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, type: "email" },

    // Dates
    { regex: /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/g, type: "date" },
    { regex: /\b\d{4}[-/]\d{2}[-/]\d{2}\b/g, type: "date" },

    // Known tech companies (capitalized words are hard to detect generically)
    { regex: /\b(?:Google|Apple|Microsoft|Amazon|Meta|Facebook|Tesla|Netflix|Nvidia|OpenAI|Anthropic|Twitter|X Corp|ByteDance|TikTok|Alibaba|Tencent|Huawei|Samsung|Intel|AMD|IBM|Oracle|Salesforce|Adobe|Uber|Airbnb|SpaceX|Coinbase|Binance)\b/g, type: "organization" },

    // Countries/locations
    { regex: /\b(?:United States|China|Japan|Germany|UK|France|India|Russia|Brazil|Australia|Canada|South Korea|Singapore|Hong Kong|Taiwan|EU|Europe|Asia|Africa)\b/g, type: "location" },
    { regex: /(?:美国|中国|日本|韩国|英国|法国|德国|印度|俄罗斯|巴西|欧洲|亚洲|北京|上海|深圳|香港|台湾|硅谷|华尔街)/g, type: "location" },
  ];

  for (const { regex, type } of patterns) {
    const matches = text.matchAll(new RegExp(regex.source, regex.flags));
    for (const m of matches) {
      const key = `${type}:${m[0].toLowerCase()}`;
      const existing = entities.get(key);
      if (existing) existing.count++;
      else entities.set(key, { text: m[0], type, count: 1 });
    }
  }

  return Array.from(entities.values()).sort((a, b) => b.count - a.count);
}

// ── Keyword Frequency Analysis ──────────────────────────

export function analyzeKeywords(texts: string[]): { word: string; count: number; sentiment: number }[] {
  const wordCounts = new Map<string, { count: number; totalSentiment: number }>();

  const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
    "in", "on", "at", "to", "for", "of", "with", "by", "from", "as", "into",
    "it", "its", "this", "that", "these", "those", "i", "you", "he", "she", "we", "they",
    "and", "or", "but", "not", "no", "if", "then", "so", "than", "just", "about",
    "的", "了", "在", "是", "和", "也", "有", "为", "就", "不", "上", "中", "到"]);

  for (const text of texts) {
    const words = text.toLowerCase().replace(/[^\w\s\u4e00-\u9fff]/g, " ").split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
    for (const word of words) {
      const entry = wordCounts.get(word) || { count: 0, totalSentiment: 0 };
      entry.count++;
      entry.totalSentiment += AFINN[word] ?? AFINN_ZH[word] ?? 0;
      wordCounts.set(word, entry);
    }
  }

  return Array.from(wordCounts.entries())
    .map(([word, { count, totalSentiment }]) => ({ word, count, sentiment: Math.round((totalSentiment / count) * 100) / 100 }))
    .filter(w => w.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);
}

// ── Full Opinion Analysis ───────────────────────────────

export function analyzeOpinion(
  query: string,
  posts: { content: string; timestamp?: string; score?: number }[]
): OpinionAnalysis {
  const sentiments = posts.map(p => ({
    ...analyzeSentiment(p.content),
    timestamp: p.timestamp,
    postScore: p.score,
  }));

  const positive = sentiments.filter(s => s.label === "positive" || s.label === "very_positive").length;
  const negative = sentiments.filter(s => s.label === "negative" || s.label === "very_negative").length;
  const neutral = sentiments.length - positive - negative;
  const avgScore = sentiments.length > 0 ? sentiments.reduce((sum, s) => sum + s.comparative, 0) / sentiments.length : 0;

  // Top positive and negative posts
  const sorted = [...sentiments].sort((a, b) => b.score - a.score);
  const topPositive = sorted.slice(0, 3).filter(s => s.score > 0).map(s => ({ text: s.text, score: s.score }));
  const topNegative = sorted.reverse().slice(0, 3).filter(s => s.score < 0).map(s => ({ text: s.text, score: s.score }));

  // All entities
  const allEntities = new Map<string, ExtractedEntity>();
  for (const s of sentiments) {
    for (const e of s.entities) {
      const key = `${e.type}:${e.text}`;
      const existing = allEntities.get(key);
      if (existing) existing.count += e.count;
      else allEntities.set(key, { ...e });
    }
  }

  // Keywords
  const keywords = analyzeKeywords(posts.map(p => p.content));

  // Timeline
  const timeline = buildTimeline(sentiments);

  return {
    query,
    totalPosts: posts.length,
    sentimentBreakdown: { positive, neutral, negative },
    averageScore: Math.round(avgScore * 1000) / 1000,
    topPositive,
    topNegative,
    entities: Array.from(allEntities.values()).sort((a, b) => b.count - a.count).slice(0, 20),
    keywords,
    timeline,
    timestamp: new Date().toISOString(),
  };
}

function buildTimeline(sentiments: { comparative: number; timestamp?: string }[]): OpinionAnalysis["timeline"] {
  const byDate = new Map<string, { total: number; count: number }>();

  for (const s of sentiments) {
    if (!s.timestamp) continue;
    const date = s.timestamp.split("T")[0];
    const entry = byDate.get(date) || { total: 0, count: 0 };
    entry.total += s.comparative;
    entry.count++;
    byDate.set(date, entry);
  }

  return Array.from(byDate.entries())
    .map(([date, { total, count }]) => ({ date, avgScore: Math.round((total / count) * 1000) / 1000, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
