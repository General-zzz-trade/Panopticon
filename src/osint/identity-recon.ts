/**
 * Identity Reconnaissance — username enumeration, email validation, social profile discovery
 * No external APIs — uses HTTP HEAD/GET checks + DNS MX verification
 */

import { execFileNoThrow } from "../utils/execFileNoThrow.js";

export interface UsernameResult {
  platform: string;
  url: string;
  exists: boolean;
  profileName?: string;
  bio?: string;
}

export interface EmailValidation {
  email: string;
  format: boolean;
  mxRecords: string[];
  disposable: boolean;
  role: boolean;
  domain: string;
  smtpReachable?: boolean;
}

export interface SocialProfile {
  platform: string;
  url: string;
  username: string;
  displayName?: string;
  bio?: string;
  followers?: string;
  verified?: boolean;
}

// ── Platform Definitions ────────────────────────────────

interface PlatformCheck {
  name: string;
  urlTemplate: string;
  existsIndicator: "status200" | "status200_noRedirect" | "bodyContains";
  bodyMatch?: string;
  category: string;
}

const PLATFORMS: PlatformCheck[] = [
  // Social Media
  { name: "GitHub", urlTemplate: "https://github.com/{}", existsIndicator: "status200", category: "dev" },
  { name: "GitLab", urlTemplate: "https://gitlab.com/{}", existsIndicator: "status200", category: "dev" },
  { name: "Reddit", urlTemplate: "https://www.reddit.com/user/{}", existsIndicator: "status200", category: "social" },
  { name: "Medium", urlTemplate: "https://medium.com/@{}", existsIndicator: "status200", category: "blog" },
  { name: "Dev.to", urlTemplate: "https://dev.to/{}", existsIndicator: "status200", category: "dev" },
  { name: "HackerNews", urlTemplate: "https://news.ycombinator.com/user?id={}", existsIndicator: "bodyContains", bodyMatch: "created:", category: "dev" },
  { name: "Keybase", urlTemplate: "https://keybase.io/{}", existsIndicator: "status200", category: "security" },
  { name: "Twitter/X", urlTemplate: "https://x.com/{}", existsIndicator: "status200_noRedirect", category: "social" },
  { name: "Instagram", urlTemplate: "https://www.instagram.com/{}/", existsIndicator: "status200", category: "social" },
  { name: "Pinterest", urlTemplate: "https://www.pinterest.com/{}/", existsIndicator: "status200", category: "social" },
  { name: "Tumblr", urlTemplate: "https://{}.tumblr.com/", existsIndicator: "status200", category: "blog" },
  { name: "Flickr", urlTemplate: "https://www.flickr.com/people/{}/", existsIndicator: "status200", category: "photo" },
  { name: "Vimeo", urlTemplate: "https://vimeo.com/{}", existsIndicator: "status200", category: "video" },
  { name: "SoundCloud", urlTemplate: "https://soundcloud.com/{}", existsIndicator: "status200", category: "audio" },
  { name: "Spotify", urlTemplate: "https://open.spotify.com/user/{}", existsIndicator: "status200", category: "audio" },
  { name: "Steam", urlTemplate: "https://steamcommunity.com/id/{}", existsIndicator: "status200", category: "gaming" },
  { name: "Twitch", urlTemplate: "https://www.twitch.tv/{}", existsIndicator: "status200", category: "gaming" },
  { name: "Patreon", urlTemplate: "https://www.patreon.com/{}", existsIndicator: "status200", category: "creator" },
  { name: "Behance", urlTemplate: "https://www.behance.net/{}", existsIndicator: "status200", category: "design" },
  { name: "Dribbble", urlTemplate: "https://dribbble.com/{}", existsIndicator: "status200", category: "design" },
  { name: "npm", urlTemplate: "https://www.npmjs.com/~{}", existsIndicator: "status200", category: "dev" },
  { name: "PyPI", urlTemplate: "https://pypi.org/user/{}/", existsIndicator: "status200", category: "dev" },
  { name: "Docker Hub", urlTemplate: "https://hub.docker.com/u/{}", existsIndicator: "status200", category: "dev" },
  { name: "StackOverflow", urlTemplate: "https://stackoverflow.com/users/?tab=accounts&SearchText={}", existsIndicator: "bodyContains", bodyMatch: "reputation", category: "dev" },
  { name: "LinkedIn", urlTemplate: "https://www.linkedin.com/in/{}/", existsIndicator: "status200", category: "professional" },
  { name: "Gravatar", urlTemplate: "https://gravatar.com/{}", existsIndicator: "status200", category: "identity" },
  { name: "About.me", urlTemplate: "https://about.me/{}", existsIndicator: "status200", category: "identity" },
  { name: "Bitbucket", urlTemplate: "https://bitbucket.org/{}/", existsIndicator: "status200", category: "dev" },
  { name: "Kaggle", urlTemplate: "https://www.kaggle.com/{}", existsIndicator: "status200", category: "data" },
  { name: "HackerRank", urlTemplate: "https://www.hackerrank.com/{}", existsIndicator: "status200", category: "dev" },
  { name: "LeetCode", urlTemplate: "https://leetcode.com/{}/", existsIndicator: "status200", category: "dev" },
  // Chinese platforms
  { name: "Zhihu", urlTemplate: "https://www.zhihu.com/people/{}", existsIndicator: "status200", category: "social" },
  { name: "Bilibili", urlTemplate: "https://space.bilibili.com/{}", existsIndicator: "status200", category: "video" },
  { name: "Gitee", urlTemplate: "https://gitee.com/{}", existsIndicator: "status200", category: "dev" },
  { name: "CSDN", urlTemplate: "https://blog.csdn.net/{}", existsIndicator: "status200", category: "dev" },
  { name: "Juejin", urlTemplate: "https://juejin.cn/user/{}", existsIndicator: "status200", category: "dev" },
  { name: "V2EX", urlTemplate: "https://www.v2ex.com/member/{}", existsIndicator: "status200", category: "dev" },
  { name: "Douban", urlTemplate: "https://www.douban.com/people/{}/", existsIndicator: "status200", category: "social" },
];

// ── Disposable Email Domains ────────────────────────────

const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com", "guerrillamail.com", "mailinator.com", "throwaway.email",
  "tempmail.com", "sharklasers.com", "guerrillamailblock.com", "grr.la",
  "guerrillamail.info", "guerrillamail.de", "guerrillamail.net", "yopmail.com",
  "trashmail.com", "trashmail.me", "trashmail.net", "dispostable.com",
  "maildrop.cc", "discard.email", "fakeinbox.com", "getairmail.com",
  "mailnesia.com", "temp-mail.org", "tempail.com", "tempr.email",
]);

// ── Role-based Email Prefixes ───────────────────────────

const ROLE_PREFIXES = new Set([
  "admin", "administrator", "info", "contact", "support", "sales",
  "marketing", "noreply", "no-reply", "webmaster", "postmaster",
  "abuse", "security", "help", "billing", "office", "hr", "legal",
  "team", "hello", "press", "media", "careers", "jobs", "feedback",
]);

// ── Username Enumeration ────────────────────────────────

async function checkPlatform(platform: PlatformCheck, username: string): Promise<UsernameResult> {
  const url = platform.urlTemplate.replace("{}", encodeURIComponent(username));

  try {
    const response = await fetch(url, {
      method: platform.existsIndicator === "bodyContains" ? "GET" : "HEAD",
      redirect: platform.existsIndicator === "status200_noRedirect" ? "manual" : "follow",
      signal: AbortSignal.timeout(10000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OSINT-Recon/1.0)",
        "Accept": "text/html",
      },
    });

    let exists = false;

    if (platform.existsIndicator === "status200" || platform.existsIndicator === "status200_noRedirect") {
      exists = response.status === 200;
    } else if (platform.existsIndicator === "bodyContains" && platform.bodyMatch) {
      const body = await response.text();
      exists = body.includes(platform.bodyMatch);
    }

    return { platform: platform.name, url, exists };
  } catch {
    return { platform: platform.name, url, exists: false };
  }
}

export async function enumerateUsername(
  username: string,
  options: { categories?: string[]; concurrency?: number } = {}
): Promise<UsernameResult[]> {
  const categories = options.categories;
  const concurrency = options.concurrency || 5;

  let platforms = PLATFORMS;
  if (categories && categories.length > 0) {
    platforms = platforms.filter(p => categories.includes(p.category));
  }

  const results: UsernameResult[] = [];

  for (let i = 0; i < platforms.length; i += concurrency) {
    const batch = platforms.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(p => checkPlatform(p, username))
    );
    results.push(...batchResults);

    // Small delay between batches to be respectful
    if (i + concurrency < platforms.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return results;
}

// ── Email Validation ────────────────────────────────────

export async function validateEmail(email: string): Promise<EmailValidation> {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const format = emailRegex.test(email);
  const parts = email.split("@");
  const domain = parts[1] || "";
  const localPart = parts[0] || "";

  const result: EmailValidation = {
    email,
    format,
    mxRecords: [],
    disposable: DISPOSABLE_DOMAINS.has(domain.toLowerCase()),
    role: ROLE_PREFIXES.has(localPart.toLowerCase()),
    domain,
  };

  if (!format) return result;

  // Check MX records
  const { stdout } = await execFileNoThrow("dig", ["+short", domain, "MX"], { timeoutMs: 10000 });
  if (stdout.trim()) {
    result.mxRecords = stdout.trim().split("\n")
      .map(line => {
        const parts = line.trim().split(/\s+/);
        return parts.length >= 2 ? parts[1].replace(/\.$/, "") : parts[0];
      })
      .filter(Boolean);
  }

  // SMTP verification (try EHLO + RCPT TO)
  if (result.mxRecords.length > 0) {
    result.smtpReachable = await checkSmtp(result.mxRecords[0], email);
  }

  return result;
}

async function checkSmtp(mxHost: string, email: string): Promise<boolean> {
  const net = await import("net");

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let step = 0;
    let settled = false;

    const done = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };

    socket.setTimeout(10000);
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));

    socket.on("data", (data) => {
      const resp = data.toString();

      if (step === 0 && resp.startsWith("220")) {
        socket.write("EHLO probe.local\r\n");
        step = 1;
      } else if (step === 1 && resp.startsWith("250")) {
        socket.write(`MAIL FROM:<probe@probe.local>\r\n`);
        step = 2;
      } else if (step === 2 && resp.startsWith("250")) {
        socket.write(`RCPT TO:<${email}>\r\n`);
        step = 3;
      } else if (step === 3) {
        done(resp.startsWith("250"));
        socket.write("QUIT\r\n");
      } else {
        done(false);
      }
    });

    socket.connect(25, mxHost);
  });
}

// ── Email → Domain Intelligence ─────────────────────────

export async function emailDomainIntel(email: string): Promise<{
  validation: EmailValidation;
  domainWhois?: string;
  webPresence?: boolean;
}> {
  const validation = await validateEmail(email);
  const domain = validation.domain;

  let domainWhois: string | undefined;
  const { stdout } = await execFileNoThrow("whois", [domain], { timeoutMs: 15000 });
  if (stdout.trim()) domainWhois = stdout.slice(0, 2000);

  let webPresence: boolean | undefined;
  try {
    const response = await fetch(`https://${domain}`, {
      method: "HEAD",
      signal: AbortSignal.timeout(10000),
    });
    webPresence = response.ok;
  } catch {
    webPresence = false;
  }

  return { validation, domainWhois, webPresence };
}

// ── Full Identity Recon ─────────────────────────────────

export interface IdentityReconResult {
  query: string;
  queryType: "username" | "email";
  usernameResults: UsernameResult[];
  emailValidation?: EmailValidation;
  foundProfiles: UsernameResult[];
  platformCount: number;
  hitRate: string;
  timestamp: string;
}

export async function fullIdentityRecon(query: string): Promise<IdentityReconResult> {
  const isEmail = query.includes("@");
  const username = isEmail ? query.split("@")[0] : query;

  const usernameResults = await enumerateUsername(username);
  const foundProfiles = usernameResults.filter(r => r.exists);

  let emailValidation: EmailValidation | undefined;
  if (isEmail) {
    emailValidation = await validateEmail(query);
  }

  return {
    query,
    queryType: isEmail ? "email" : "username",
    usernameResults,
    emailValidation,
    foundProfiles,
    platformCount: usernameResults.length,
    hitRate: `${foundProfiles.length}/${usernameResults.length}`,
    timestamp: new Date().toISOString(),
  };
}
