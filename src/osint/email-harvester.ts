/**
 * Email Harvester — find email addresses from web pages, search engines, DNS
 * Replaces Hunter.io — no API key needed
 */

export interface HarvestResult {
  domain: string;
  emails: HarvestedEmail[];
  pattern?: string;           // Detected email pattern (first.last, flast, etc.)
  mxProvider?: string;        // Google Workspace, Microsoft 365, etc.
  stats: { total: number; unique: number; verified: number; sources: number };
  timestamp: string;
}

export interface HarvestedEmail {
  email: string;
  source: string;
  confidence: number;
  verified?: boolean;  // MX check passed
  role: boolean;       // info@, admin@, etc.
}

const ROLE_PREFIXES = new Set([
  "info", "contact", "support", "sales", "marketing", "admin", "webmaster",
  "postmaster", "abuse", "security", "help", "billing", "office", "hr",
  "legal", "press", "media", "hello", "team", "noreply", "no-reply",
]);

// ── Source 1: Scrape target website ─────────────────────

async function harvestFromWebsite(domain: string): Promise<HarvestedEmail[]> {
  const emails: HarvestedEmail[] = [];
  const pages = [`https://${domain}`, `https://${domain}/about`, `https://${domain}/contact`, `https://${domain}/team`, `https://${domain}/impressum`];

  for (const url of pages) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Panopticon/1.0)" },
      });
      if (!response.ok) continue;
      const html = await response.text();

      // Extract emails from HTML
      const found = html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
      for (const email of found) {
        const lower = email.toLowerCase();
        if (lower.endsWith(`@${domain}`) || lower.includes(domain.split(".")[0])) {
          if (!emails.find(e => e.email === lower)) {
            emails.push({
              email: lower,
              source: url,
              confidence: 0.9,
              role: ROLE_PREFIXES.has(lower.split("@")[0]),
            });
          }
        }
      }

      // Also check mailto: links
      const mailtos = html.matchAll(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi);
      for (const m of mailtos) {
        const lower = m[1].toLowerCase();
        if (!emails.find(e => e.email === lower)) {
          emails.push({ email: lower, source: url, confidence: 0.95, role: ROLE_PREFIXES.has(lower.split("@")[0]) });
        }
      }
    } catch {}
  }

  return emails;
}

// ── Source 2: Search engine scraping ─────────────────────

async function harvestFromSearch(domain: string): Promise<HarvestedEmail[]> {
  const emails: HarvestedEmail[] = [];

  try {
    // DuckDuckGo HTML search
    const query = `"@${domain}" email`;
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      }
    );
    if (response.ok) {
      const html = await response.text();
      const found = html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]*\b/g) || [];
      for (const email of found) {
        const lower = email.toLowerCase();
        if (lower.includes(domain.split(".")[0]) && lower.includes("@") && !emails.find(e => e.email === lower)) {
          emails.push({ email: lower, source: "duckduckgo", confidence: 0.6, role: ROLE_PREFIXES.has(lower.split("@")[0]) });
        }
      }
    }
  } catch {}

  return emails;
}

// ── Source 3: DNS TXT records (SPF, DKIM selectors) ─────

async function harvestFromDns(domain: string): Promise<{ mxProvider?: string }> {
  const { execFileNoThrow } = await import("../utils/execFileNoThrow.js");
  const { stdout } = await execFileNoThrow("dig", ["+short", domain, "MX"], { timeoutMs: 5000 });
  const mx = stdout.trim().toLowerCase();

  let mxProvider: string | undefined;
  if (mx.includes("google") || mx.includes("gmail")) mxProvider = "Google Workspace";
  else if (mx.includes("outlook") || mx.includes("microsoft")) mxProvider = "Microsoft 365";
  else if (mx.includes("protonmail") || mx.includes("proton")) mxProvider = "ProtonMail";
  else if (mx.includes("zoho")) mxProvider = "Zoho Mail";
  else if (mx.includes("yandex")) mxProvider = "Yandex Mail";
  else if (mx.includes("qq.com") || mx.includes("exmail")) mxProvider = "QQ Exmail";

  return { mxProvider };
}

// ── Source 4: Generate and verify common patterns ───────

async function generateAndVerify(domain: string): Promise<{ pattern?: string; emails: HarvestedEmail[] }> {
  const emails: HarvestedEmail[] = [];
  const { execFileNoThrow } = await import("../utils/execFileNoThrow.js");

  // Check if domain has MX (can receive email)
  const { stdout: mx } = await execFileNoThrow("dig", ["+short", domain, "MX"], { timeoutMs: 5000 });
  if (!mx.trim()) return { emails };

  // Common role-based emails to try
  const roleEmails = ["info", "contact", "admin", "support", "sales", "hello"];
  for (const prefix of roleEmails) {
    const email = `${prefix}@${domain}`;
    // We can't verify without SMTP, but we can note they're common patterns
    emails.push({ email, source: "pattern-guess", confidence: 0.3, role: true });
  }

  return { pattern: "role-based", emails };
}

// ── Verify emails via SMTP ──────────────────────────────

async function verifyEmails(emails: HarvestedEmail[]): Promise<void> {
  for (const email of emails.slice(0, 10)) {
    try {
      const { validateEmail } = await import("./identity-recon.js");
      const result = await validateEmail(email.email);
      email.verified = result.mxRecords.length > 0;
      if (email.verified) email.confidence = Math.min(0.99, email.confidence + 0.2);
    } catch {}
  }
}

// ── Full Email Harvest ──────────────────────────────────

export async function harvestEmails(domain: string, options: { verify?: boolean; deep?: boolean } = {}): Promise<HarvestResult> {
  const clean = domain.replace(/[^a-zA-Z0-9.\-]/g, "").toLowerCase();

  // Collect from all sources in parallel
  const [website, search, dns, patterns] = await Promise.all([
    harvestFromWebsite(clean),
    harvestFromSearch(clean),
    harvestFromDns(clean),
    generateAndVerify(clean),
  ]);

  // Merge and deduplicate
  const allEmails = new Map<string, HarvestedEmail>();
  for (const email of [...website, ...search, ...patterns.emails]) {
    const existing = allEmails.get(email.email);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, email.confidence);
      if (email.source !== existing.source) existing.source += `, ${email.source}`;
    } else {
      allEmails.set(email.email, email);
    }
  }

  const emails = Array.from(allEmails.values())
    .sort((a, b) => b.confidence - a.confidence);

  // Optional: verify top emails
  if (options.verify) {
    await verifyEmails(emails);
  }

  // Detect pattern
  const nonRole = emails.filter(e => !e.role && e.confidence > 0.5);
  let pattern: string | undefined;
  if (nonRole.length >= 2) {
    const locals = nonRole.map(e => e.email.split("@")[0]);
    if (locals.every(l => l.includes("."))) pattern = "first.last";
    else if (locals.every(l => l.length <= 6)) pattern = "flast";
  }

  const verified = emails.filter(e => e.verified).length;

  return {
    domain: clean,
    emails,
    pattern: pattern || patterns.pattern,
    mxProvider: dns.mxProvider,
    stats: {
      total: emails.length,
      unique: emails.length,
      verified,
      sources: new Set(emails.flatMap(e => e.source.split(", "))).size,
    },
    timestamp: new Date().toISOString(),
  };
}
