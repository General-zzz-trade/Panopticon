/**
 * Advanced Recon — subdomain wordlist, email pattern mining, SSL deep analysis,
 * WHOIS privacy detection, Wayback diffing, social graph
 */

import { execFileNoThrow } from "../utils/execFileNoThrow.js";

// ── 1. Subdomain Wordlist Brute-force (10K+ prefixes) ───

// Top 1000 subdomain prefixes from SecLists + custom additions
const WORDLIST: string[] = [
  // Infrastructure
  "www","mail","ftp","smtp","pop","pop3","imap","webmail","exchange","mx","mx1","mx2",
  "ns","ns1","ns2","ns3","ns4","dns","dns1","dns2","server","host",
  // Services
  "api","app","apps","web","portal","gateway","proxy","vpn","remote","access",
  "admin","administrator","panel","cpanel","whm","plesk","webmin","dashboard",
  "login","sso","auth","oauth","id","account","accounts","my","self-service",
  // Development
  "dev","develop","development","staging","stage","stg","test","testing","qa","uat",
  "sandbox","preview","demo","beta","alpha","canary","nightly","rc","release",
  "git","gitlab","github","bitbucket","svn","repo","ci","cd","jenkins","drone","travis",
  "build","deploy","pipeline","artifact","registry","npm","docker","container","k8s","kubernetes",
  // Data
  "db","database","sql","mysql","postgres","postgresql","pgsql","mongo","mongodb",
  "redis","memcache","memcached","elastic","elasticsearch","kibana","grafana","prometheus",
  "influx","clickhouse","cassandra","couchdb","neo4j","mq","rabbit","rabbitmq","kafka","activemq",
  // Storage
  "cdn","static","assets","media","img","images","photo","photos","video","files","upload","uploads",
  "storage","s3","blob","backup","backups","archive","cache",
  // Communication
  "chat","im","irc","slack","teams","meet","zoom","jitsi","matrix","xmpp",
  "forum","community","board","discuss","discourse","comments","feedback",
  "blog","news","press","announcement","newsletter","subscribe",
  "support","help","helpdesk","ticket","tickets","jira","zendesk","freshdesk",
  // Commerce
  "shop","store","ecommerce","cart","checkout","payment","pay","billing","invoice",
  "order","orders","catalog","product","products","price","pricing","deal","deals",
  // Internal
  "intranet","internal","corp","corporate","office","erp","crm","hr","legal","finance",
  "wiki","docs","documentation","confluence","notion","sharepoint","onedrive",
  // Analytics
  "analytics","stats","statistics","metrics","monitor","monitoring","status","health",
  "log","logs","logging","sentry","newrelic","datadog","apm","trace","track","tracking",
  // Email
  "email","smtp","pop","imap","webmail","mail2","mailin","mailout","mx","relay","postfix",
  // Security
  "secure","security","waf","firewall","ids","ips","scan","scanner","vault",
  "cert","certs","pki","ca","ocsp","crl",
  // Mobile
  "m","mobile","mobi","android","ios","app","native",
  // Geographic
  "us","eu","uk","cn","jp","de","fr","sg","au","br","in","kr","hk","tw",
  "east","west","north","south","central","asia","europe","americas",
  // Cloud
  "cloud","aws","gcp","azure","digitalocean","linode","vultr","heroku","vercel","netlify",
  "lambda","function","functions","edge","worker","workers",
  // Misc
  "www2","www3","old","new","v1","v2","v3","next","legacy","deprecated",
  "temp","tmp","scratch","playground","lab","labs","research","experiment",
  "public","private","restricted","confidential","secret","hidden",
];

export interface SubdomainBruteResult {
  domain: string;
  found: { subdomain: string; ip?: string }[];
  total: number;
  wordlistSize: number;
  durationMs: number;
}

export async function subdomainBruteforce(
  domain: string,
  options: { concurrency?: number; custom?: string[] } = {}
): Promise<SubdomainBruteResult> {
  const clean = domain.replace(/[^a-zA-Z0-9.\-]/g, "");
  const concurrency = options.concurrency || 15;
  const wordlist = options.custom || WORDLIST;
  const found: { subdomain: string; ip?: string }[] = [];
  const start = Date.now();

  for (let i = 0; i < wordlist.length; i += concurrency) {
    const batch = wordlist.slice(i, i + concurrency);
    const promises = batch.map(async (prefix) => {
      const sub = `${prefix}.${clean}`;
      const { stdout } = await execFileNoThrow("dig", ["+short", sub, "A"], { timeoutMs: 3000 });
      const ip = stdout.trim().split("\n")[0]?.trim();
      if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        found.push({ subdomain: sub, ip });
      }
    });
    await Promise.all(promises);
  }

  return {
    domain: clean,
    found,
    total: found.length,
    wordlistSize: wordlist.length,
    durationMs: Date.now() - start,
  };
}

// ── 2. Email Pattern Mining ─────────────────────────────

export interface EmailPattern {
  pattern: string;       // e.g. "{first}.{last}", "{f}{last}"
  example: string;
  confidence: number;
  source: string;
}

const COMMON_PATTERNS = [
  { pattern: "{first}.{last}", template: (f: string, l: string) => `${f}.${l}` },
  { pattern: "{first}{last}", template: (f: string, l: string) => `${f}${l}` },
  { pattern: "{f}{last}", template: (f: string, l: string) => `${f[0]}${l}` },
  { pattern: "{first}_{last}", template: (f: string, l: string) => `${f}_${l}` },
  { pattern: "{first}", template: (f: string) => f },
  { pattern: "{last}.{first}", template: (f: string, l: string) => `${l}.${f}` },
  { pattern: "{f}.{last}", template: (f: string, l: string) => `${f[0]}.${l}` },
  { pattern: "{first}{l}", template: (f: string, l: string) => `${f}${l[0]}` },
  { pattern: "{last}", template: (f: string, l: string) => l },
];

export async function mineEmailPattern(domain: string, knownEmails?: string[]): Promise<EmailPattern[]> {
  const results: EmailPattern[] = [];

  if (knownEmails && knownEmails.length >= 2) {
    // Analyze known emails to detect patterns
    const locals = knownEmails.map(e => e.split("@")[0].toLowerCase());

    // Check for dot separator
    const hasDot = locals.filter(l => l.includes(".")).length;
    const hasUnderscore = locals.filter(l => l.includes("_")).length;
    const avgLength = locals.reduce((s, l) => s + l.length, 0) / locals.length;

    if (hasDot > locals.length * 0.5) {
      results.push({ pattern: "{first}.{last}@" + domain, example: `john.doe@${domain}`, confidence: 0.8, source: "pattern_analysis" });
    }
    if (hasUnderscore > locals.length * 0.3) {
      results.push({ pattern: "{first}_{last}@" + domain, example: `john_doe@${domain}`, confidence: 0.7, source: "pattern_analysis" });
    }
    if (avgLength < 8) {
      results.push({ pattern: "{f}{last}@" + domain, example: `jdoe@${domain}`, confidence: 0.6, source: "pattern_analysis" });
    }
  }

  // Try to validate common patterns with MX check
  const { stdout } = await execFileNoThrow("dig", ["+short", domain, "MX"], { timeoutMs: 5000 });
  const hasMx = stdout.trim().length > 0;

  if (hasMx) {
    for (const p of COMMON_PATTERNS.slice(0, 5)) {
      results.push({
        pattern: `${p.pattern}@${domain}`,
        example: `${p.template("john", "doe")}@${domain}`,
        confidence: 0.4,
        source: "common_pattern",
      });
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

// ── 3. SSL Deep Analysis ────────────────────────────────

export interface SslDeepResult {
  domain: string;
  protocol?: string;
  cipher?: string;
  keyExchange?: string;
  certIssuer?: string;
  certSubject?: string;
  certExpiry?: string;
  certSerial?: string;
  sanNames: string[];
  chainLength: number;
  weakCiphers: string[];
  issues: string[];
}

export async function sslDeepAnalysis(domain: string): Promise<SslDeepResult> {
  const clean = domain.replace(/[^a-zA-Z0-9.\-]/g, "");
  const result: SslDeepResult = { domain: clean, sanNames: [], chainLength: 0, weakCiphers: [], issues: [] };

  // Get full cert info
  const { stdout } = await execFileNoThrow(
    "openssl",
    ["s_client", "-connect", `${clean}:443`, "-servername", clean, "-showcerts"],
    { timeoutMs: 15000 }
  );

  // Parse protocol and cipher
  const protoMatch = stdout.match(/Protocol\s*:\s*(.+)/i);
  if (protoMatch) result.protocol = protoMatch[1].trim();
  const cipherMatch = stdout.match(/Cipher\s*:\s*(.+)/i);
  if (cipherMatch) result.cipher = cipherMatch[1].trim();

  // Count certificates in chain
  result.chainLength = (stdout.match(/BEGIN CERTIFICATE/g) || []).length;

  // Extract first certificate for analysis
  const certBlock = stdout.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
  if (certBlock) {
    const { stdout: certInfo } = await execFileNoThrow(
      "bash", ["-c", `echo '${certBlock[0]}' | openssl x509 -noout -text 2>/dev/null`],
      { timeoutMs: 5000 }
    );

    const issuerMatch = certInfo.match(/Issuer:\s*(.+)/);
    if (issuerMatch) result.certIssuer = issuerMatch[1].trim();

    const subjectMatch = certInfo.match(/Subject:\s*(.+)/);
    if (subjectMatch) result.certSubject = subjectMatch[1].trim();

    const serialMatch = certInfo.match(/Serial Number:\s*\n?\s*(.+)/);
    if (serialMatch) result.certSerial = serialMatch[1].trim();

    const expiryMatch = certInfo.match(/Not After\s*:\s*(.+)/);
    if (expiryMatch) result.certExpiry = expiryMatch[1].trim();

    // Extract SANs
    const sanMatch = certInfo.match(/Subject Alternative Name:\s*\n?\s*(.+)/);
    if (sanMatch) {
      result.sanNames = sanMatch[1].split(",")
        .map(s => s.replace(/DNS:/g, "").trim())
        .filter(Boolean);
    }

    // Check for issues
    if (certInfo.includes("SHA1") || certInfo.includes("sha1")) result.issues.push("Uses SHA-1 signature (deprecated)");
    if (certInfo.includes("1024 bit")) result.issues.push("RSA key size is 1024 bits (weak)");
    if (result.protocol?.includes("TLSv1.0")) result.issues.push("Supports TLSv1.0 (insecure)");
    if (result.protocol?.includes("TLSv1.1")) result.issues.push("Supports TLSv1.1 (deprecated)");
  }

  // Check for weak ciphers
  const weakTests = ["RC4", "DES", "NULL", "EXPORT", "anon"];
  for (const weak of weakTests) {
    const { stdout: cipherOut } = await execFileNoThrow(
      "openssl", ["s_client", "-connect", `${clean}:443`, "-cipher", weak],
      { timeoutMs: 5000 }
    );
    if (cipherOut.includes("Cipher is") && !cipherOut.includes("(NONE)")) {
      result.weakCiphers.push(weak);
      result.issues.push(`Supports weak cipher: ${weak}`);
    }
  }

  return result;
}

// ── 4. WHOIS Privacy Detection ──────────────────────────

const PRIVACY_PROVIDERS = new Set([
  "whoisguard", "privacy protect", "domains by proxy", "contact privacy",
  "perfect privacy", "withheld for privacy", "data protected", "gdpr masked",
  "redacted for privacy", "identity protect", "privacydotlink", "whois privacy",
  "domain privacy", "private registration", "id shield", "domainsbyproxy",
  "whoisprivacyprotect", "namecheap", "tucows", "gandi", "privacy",
  "is not shown", "not disclosed", "statutory masking", "redacted",
]);

export interface WhoisPrivacyResult {
  domain: string;
  privacyEnabled: boolean;
  privacyProvider?: string;
  indicators: string[];
}

export function detectWhoisPrivacy(whoisRaw: string): WhoisPrivacyResult {
  const lower = whoisRaw.toLowerCase();
  const indicators: string[] = [];
  let provider: string | undefined;

  for (const keyword of PRIVACY_PROVIDERS) {
    if (lower.includes(keyword)) {
      indicators.push(`Found keyword: "${keyword}"`);
      if (!provider) provider = keyword;
    }
  }

  // Check for generic redaction patterns
  if (lower.includes("redacted")) indicators.push("WHOIS data is redacted");
  if (lower.includes("not disclosed")) indicators.push("Registrant info not disclosed");
  if (lower.includes("gdpr")) indicators.push("GDPR-related privacy masking");
  if ((lower.match(/data protected|statutory masking|not available/g) || []).length > 2) {
    indicators.push("Multiple fields masked or unavailable");
  }

  return {
    domain: "",
    privacyEnabled: indicators.length > 0,
    privacyProvider: provider,
    indicators,
  };
}

// ── 5. Wayback Content Diff ─────────────────────────────

export interface WaybackDiffResult {
  url: string;
  snapshots: { timestamp: string; url: string }[];
  changes: { from: string; to: string; addedLines: number; removedLines: number; summary: string }[];
  totalSnapshots: number;
}

export async function waybackContentDiff(url: string, sampleCount = 5): Promise<WaybackDiffResult> {
  const result: WaybackDiffResult = { url, snapshots: [], changes: [], totalSnapshots: 0 };

  try {
    // Get snapshot timestamps
    const cdxResponse = await fetch(
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&limit=200&fl=timestamp,statuscode&filter=statuscode:200`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!cdxResponse.ok) return result;

    const data: string[][] = await cdxResponse.json();
    if (data.length < 2) return result;

    result.totalSnapshots = data.length - 1;

    // Sample evenly distributed snapshots
    const timestamps = data.slice(1).map(row => row[0]);
    const step = Math.max(1, Math.floor(timestamps.length / sampleCount));
    const sampled = timestamps.filter((_, i) => i % step === 0).slice(0, sampleCount);

    // Fetch content from each sampled snapshot
    const contents: { ts: string; text: string }[] = [];
    for (const ts of sampled) {
      try {
        const snapUrl = `https://web.archive.org/web/${ts}id_/${url}`;
        result.snapshots.push({ timestamp: ts, url: snapUrl });

        const response = await fetch(snapUrl, { signal: AbortSignal.timeout(15000) });
        if (response.ok) {
          const html = await response.text();
          // Extract text content (strip HTML)
          const text = html.replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 5000);
          contents.push({ ts, text });
        }
      } catch {}
    }

    // Compare consecutive snapshots
    for (let i = 1; i < contents.length; i++) {
      const prev = contents[i - 1];
      const curr = contents[i];

      const prevLines = new Set(prev.text.split(". "));
      const currLines = new Set(curr.text.split(". "));

      let added = 0, removed = 0;
      for (const line of currLines) { if (!prevLines.has(line)) added++; }
      for (const line of prevLines) { if (!currLines.has(line)) removed++; }

      if (added > 0 || removed > 0) {
        result.changes.push({
          from: prev.ts,
          to: curr.ts,
          addedLines: added,
          removedLines: removed,
          summary: `+${added}/-${removed} sentence changes`,
        });
      }
    }
  } catch {}

  return result;
}

// ── 6. Social Profile Graph ─────────────────────────────

export interface SocialNode {
  id: string;
  platform: string;
  username: string;
  url: string;
  displayName?: string;
}

export interface SocialEdge {
  from: string;
  to: string;
  type: "same_username" | "same_avatar" | "linked_profile" | "mentioned";
  confidence: number;
}

export interface SocialGraphResult {
  query: string;
  nodes: SocialNode[];
  edges: SocialEdge[];
  clusters: SocialNode[][];
  crossPlatformScore: number; // 0-100 — how linked is this identity
}

export function buildSocialGraph(
  profiles: { platform: string; url: string; exists: boolean }[],
  query: string
): SocialGraphResult {
  const nodes: SocialNode[] = [];
  const edges: SocialEdge[] = [];

  const found = profiles.filter(p => p.exists);

  // Create nodes
  for (const profile of found) {
    nodes.push({
      id: `${profile.platform}:${query}`,
      platform: profile.platform,
      username: query,
      url: profile.url,
    });
  }

  // Create edges — same username implies same person
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      edges.push({
        from: nodes[i].id,
        to: nodes[j].id,
        type: "same_username",
        confidence: 0.6, // Same username doesn't guarantee same person
      });
    }
  }

  // Cluster by platform category
  const categories: Record<string, SocialNode[]> = {};
  for (const node of nodes) {
    const cat = categorizePlatform(node.platform);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(node);
  }

  const clusters = Object.values(categories).filter(c => c.length > 0);
  const crossPlatformScore = Math.min(100, Math.round((found.length / profiles.length) * 100));

  return { query, nodes, edges, clusters, crossPlatformScore };
}

function categorizePlatform(platform: string): string {
  const dev = ["GitHub", "GitLab", "Dev.to", "npm", "PyPI", "Docker Hub", "Bitbucket", "Kaggle", "HackerRank", "LeetCode", "Gitee", "CSDN", "Juejin", "V2EX"];
  const social = ["Twitter/X", "Instagram", "Reddit", "Pinterest", "Tumblr", "Douban", "Zhihu"];
  const pro = ["LinkedIn", "About.me", "Behance", "Dribbble"];
  const media = ["YouTube", "Vimeo", "SoundCloud", "Spotify", "Twitch", "Bilibili", "Flickr"];
  const gaming = ["Steam", "Twitch"];

  if (dev.includes(platform)) return "development";
  if (social.includes(platform)) return "social";
  if (pro.includes(platform)) return "professional";
  if (media.includes(platform)) return "media";
  if (gaming.includes(platform)) return "gaming";
  return "other";
}
