/**
 * Breach & Leak Check — password leak detection, email breach lookup
 * Uses HaveIBeenPwned k-anonymity API (free, no key) + local pattern analysis
 */

import * as crypto from "crypto";

export interface BreachResult {
  email?: string;
  passwordHash?: string;
  breached: boolean;
  pwnedCount?: number;
  breaches: BreachEntry[];
  passwordStrength?: PasswordAnalysis;
  timestamp: string;
}

export interface BreachEntry {
  name: string;
  domain?: string;
  breachDate?: string;
  addedDate?: string;
  pwnCount?: number;
  dataClasses?: string[];
  description?: string;
  isVerified: boolean;
}

export interface PasswordAnalysis {
  length: number;
  hasUpper: boolean;
  hasLower: boolean;
  hasDigit: boolean;
  hasSpecial: boolean;
  entropy: number;
  score: "very_weak" | "weak" | "fair" | "strong" | "very_strong";
  timeToCrack: string;
  leaked: boolean;
  leakCount: number;
}

// ── HaveIBeenPwned Password Check (k-anonymity) ────────

export async function checkPasswordLeak(password: string): Promise<{ leaked: boolean; count: number }> {
  // SHA-1 hash the password
  const sha1 = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    // k-anonymity: send only first 5 chars of hash
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "OSINT-Agent-BreachCheck" },
    });

    if (!response.ok) return { leaked: false, count: 0 };

    const text = await response.text();

    for (const line of text.split("\n")) {
      const [hashSuffix, count] = line.trim().split(":");
      if (hashSuffix === suffix) {
        return { leaked: true, count: parseInt(count, 10) };
      }
    }
  } catch {}

  return { leaked: false, count: 0 };
}

// ── Password Strength Analysis ──────────────────────────

export function analyzePassword(password: string): Omit<PasswordAnalysis, "leaked" | "leakCount"> {
  const length = password.length;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  // Calculate entropy
  let charsetSize = 0;
  if (hasLower) charsetSize += 26;
  if (hasUpper) charsetSize += 26;
  if (hasDigit) charsetSize += 10;
  if (hasSpecial) charsetSize += 32;
  const entropy = Math.round(length * Math.log2(charsetSize || 1));

  // Score
  let score: PasswordAnalysis["score"];
  if (entropy < 28) score = "very_weak";
  else if (entropy < 36) score = "weak";
  else if (entropy < 60) score = "fair";
  else if (entropy < 80) score = "strong";
  else score = "very_strong";

  // Time to crack (assuming 10 billion guesses/sec)
  const combinations = Math.pow(charsetSize || 1, length);
  const seconds = combinations / 1e10;
  let timeToCrack: string;
  if (seconds < 1) timeToCrack = "Instant";
  else if (seconds < 60) timeToCrack = `${Math.round(seconds)} seconds`;
  else if (seconds < 3600) timeToCrack = `${Math.round(seconds / 60)} minutes`;
  else if (seconds < 86400) timeToCrack = `${Math.round(seconds / 3600)} hours`;
  else if (seconds < 31536000) timeToCrack = `${Math.round(seconds / 86400)} days`;
  else if (seconds < 31536000 * 1000) timeToCrack = `${Math.round(seconds / 31536000)} years`;
  else timeToCrack = "Centuries+";

  return { length, hasUpper, hasLower, hasDigit, hasSpecial, entropy, score, timeToCrack };
}

// ── Email Breach Check (HIBP — requires API key for v3) ──
// Note: v3 API requires paid key, so we use the free password API only
// and provide domain breach intelligence from public sources

export async function checkEmailBreaches(email: string): Promise<BreachEntry[]> {
  const domain = email.split("@")[1];
  const breaches: BreachEntry[] = [];

  // Check domain against known breach lists (public knowledge)
  const knownBreaches: Record<string, BreachEntry> = {
    "linkedin.com": { name: "LinkedIn", domain: "linkedin.com", breachDate: "2012-05-05", pwnCount: 164611595, dataClasses: ["Email addresses", "Passwords"], isVerified: true },
    "adobe.com": { name: "Adobe", domain: "adobe.com", breachDate: "2013-10-04", pwnCount: 152445165, dataClasses: ["Email addresses", "Password hints", "Passwords", "Usernames"], isVerified: true },
    "dropbox.com": { name: "Dropbox", domain: "dropbox.com", breachDate: "2012-07-01", pwnCount: 68648009, dataClasses: ["Email addresses", "Passwords"], isVerified: true },
    "yahoo.com": { name: "Yahoo", domain: "yahoo.com", breachDate: "2013-08-01", pwnCount: 3000000000, dataClasses: ["Dates of birth", "Email addresses", "Names", "Phone numbers", "Security questions"], isVerified: true },
    "myspace.com": { name: "MySpace", domain: "myspace.com", breachDate: "2008-07-01", pwnCount: 359420698, dataClasses: ["Email addresses", "Passwords", "Usernames"], isVerified: true },
    "canva.com": { name: "Canva", domain: "canva.com", breachDate: "2019-05-24", pwnCount: 137272116, dataClasses: ["Email addresses", "Names", "Passwords", "Usernames"], isVerified: true },
    "163.com": { name: "NetEase/163", domain: "163.com", breachDate: "2015-10-19", pwnCount: 234842089, dataClasses: ["Email addresses", "Passwords"], isVerified: true },
    "qq.com": { name: "QQ/Tencent", domain: "qq.com", breachDate: "2019-01-01", pwnCount: 89000000, dataClasses: ["Email addresses", "Passwords", "Phone numbers"], isVerified: false },
  };

  // Check if email domain matches known breach
  if (domain && knownBreaches[domain]) {
    breaches.push({
      ...knownBreaches[domain],
      description: `The email provider ${domain} has been breached. User credentials may be compromised.`,
    });
  }

  return breaches;
}

// ── Full Breach Analysis ────────────────────────────────

export async function fullBreachCheck(input: string): Promise<BreachResult> {
  const isEmail = input.includes("@");

  const result: BreachResult = {
    breached: false,
    breaches: [],
    timestamp: new Date().toISOString(),
  };

  if (isEmail) {
    result.email = input;
    result.breaches = await checkEmailBreaches(input);
    result.breached = result.breaches.length > 0;
  } else {
    // Treat as password
    result.passwordHash = crypto.createHash("sha1").update(input).digest("hex").toUpperCase().slice(0, 10) + "...";
    const leak = await checkPasswordLeak(input);
    const strength = analyzePassword(input);

    result.passwordStrength = {
      ...strength,
      leaked: leak.leaked,
      leakCount: leak.count,
    };
    result.breached = leak.leaked;
    result.pwnedCount = leak.count;
  }

  return result;
}
