/**
 * GitHub/Code Repository Reconnaissance — public repo scanning for leaked secrets
 * No API key — uses GitHub public search + code search via web scraping
 */

export interface GithubReconResult {
  query: string;
  repos: GithubRepo[];
  codeMatches: CodeMatch[];
  gists: GistMatch[];
  stats: { repos: number; codeHits: number; gists: number };
  timestamp: string;
}

export interface GithubRepo {
  name: string;
  url: string;
  description?: string;
  language?: string;
  stars: number;
  forks: number;
  updatedAt?: string;
}

export interface CodeMatch {
  repo: string;
  file: string;
  url: string;
  matchLine: string;
  secretType?: string;
}

export interface GistMatch {
  url: string;
  description?: string;
  files: string[];
}

// ── Secret Patterns ─────────────────────────────────────

const SECRET_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "AWS Secret Key", regex: /(?:aws_secret|secret_key|aws_secret_access_key)\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}/ },
  { name: "GitHub Token", regex: /gh[ps]_[A-Za-z0-9_]{36,}/ },
  { name: "Google API Key", regex: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: "Slack Token", regex: /xox[bpors]-[0-9]{10,}-[0-9a-zA-Z]{20,}/ },
  { name: "Stripe Key", regex: /sk_live_[0-9a-zA-Z]{24,}/ },
  { name: "Private Key", regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/ },
  { name: "JWT Token", regex: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { name: "Generic Secret", regex: /(?:password|passwd|secret|token|api_key|apikey|access_key)\s*[=:]\s*['"][^'"]{8,}['"]/ },
  { name: "Database URL", regex: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^/]+/ },
  { name: "SendGrid Key", regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/ },
  { name: "Twilio SID", regex: /AC[a-f0-9]{32}/ },
  { name: "Mailgun Key", regex: /key-[0-9a-zA-Z]{32}/ },
  { name: "Heroku API Key", regex: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/ },
  { name: "SSH Key", regex: /ssh-(?:rsa|dss|ed25519)\s+AAAA[A-Za-z0-9+/]+/ },
];

// ── GitHub Headers (optional token support) ─────────────

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "Panopticon-OSINT",
  };
  // Support optional GITHUB_TOKEN for higher rate limits (5000/hr vs 10/min)
  const token = process.env.GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export let githubRateLimited = false;

// ── GitHub Search ───────────────────────────────────────

export async function searchGithubRepos(query: string): Promise<GithubRepo[]> {
  const repos: GithubRepo[] = [];
  if (githubRateLimited) return repos;

  try {
    const response = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=updated&per_page=20`,
      { signal: AbortSignal.timeout(15000), headers: githubHeaders() }
    );

    // Detect rate limiting
    if (response.status === 403 || response.status === 429) {
      githubRateLimited = true;
      // Auto-reset after 60s
      setTimeout(() => { githubRateLimited = false; }, 60000);
      return repos;
    }

    if (response.ok) {
      const data = await response.json();
      for (const item of (data.items || [])) {
        repos.push({
          name: item.full_name,
          url: item.html_url,
          description: item.description?.slice(0, 200),
          language: item.language,
          stars: item.stargazers_count,
          forks: item.forks_count,
          updatedAt: item.updated_at,
        });
      }
    }
  } catch {}

  return repos;
}

export async function searchGithubCode(query: string): Promise<CodeMatch[]> {
  const matches: CodeMatch[] = [];

  try {
    const response = await fetch(
      `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=20`,
      {
        signal: AbortSignal.timeout(15000),
        headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "OSINT-Agent" },
      }
    );

    if (response.ok) {
      const data = await response.json();
      for (const item of (data.items || [])) {
        matches.push({
          repo: item.repository?.full_name || "",
          file: item.path || "",
          url: item.html_url || "",
          matchLine: item.name || "",
        });
      }
    }
  } catch {}

  return matches;
}

// ── Scan for Leaked Secrets ─────────────────────────────

export function scanForSecrets(content: string, filename?: string): CodeMatch[] {
  const matches: CodeMatch[] = [];

  for (const { name, regex } of SECRET_PATTERNS) {
    const found = content.match(regex);
    if (found) {
      matches.push({
        repo: "",
        file: filename || "unknown",
        url: "",
        matchLine: found[0].slice(0, 80) + (found[0].length > 80 ? "..." : ""),
        secretType: name,
      });
    }
  }

  return matches;
}

// ── Search for Organization Leaks ───────────────────────

export async function scanOrgLeaks(orgOrDomain: string): Promise<GithubReconResult> {
  const domain = orgOrDomain.replace(/^https?:\/\//, "").split("/")[0];
  const start = Date.now();

  // Search queries targeting potential leaks
  const queries = [
    `"${domain}" password OR secret OR token OR api_key`,
    `"${domain}" filename:.env`,
    `"${domain}" filename:config extension:json password`,
    `org:${domain.split(".")[0]} filename:.env OR filename:.credentials`,
  ];

  const allRepos: GithubRepo[] = [];
  const allCodeMatches: CodeMatch[] = [];
  const allGists: GistMatch[] = [];

  for (const query of queries) {
    // Rate limit: small delay between queries
    await new Promise(r => setTimeout(r, 2000));

    const repos = await searchGithubRepos(query);
    allRepos.push(...repos);

    const code = await searchGithubCode(query);
    allCodeMatches.push(...code);
  }

  // Deduplicate repos
  const uniqueRepos = Array.from(
    new Map(allRepos.map(r => [r.url, r])).values()
  );

  // Deduplicate code matches
  const uniqueCode = Array.from(
    new Map(allCodeMatches.map(m => [m.url, m])).values()
  );

  return {
    query: orgOrDomain,
    repos: uniqueRepos,
    codeMatches: uniqueCode,
    gists: allGists,
    stats: {
      repos: uniqueRepos.length,
      codeHits: uniqueCode.length,
      gists: allGists.length,
    },
    timestamp: new Date().toISOString(),
  };
}

// ── Full GitHub Recon ───────────────────────────────────

export async function fullGithubRecon(target: string): Promise<GithubReconResult> {
  return scanOrgLeaks(target);
}
