/**
 * Company Intelligence — corporate registry, ownership, financial data
 * Uses free public sources: SEC EDGAR full-text search, UK Companies House, Wikipedia
 */

export interface CompanyInfo {
  name: string;
  jurisdiction?: string;
  registrationNumber?: string;
  status?: string;
  incorporationDate?: string;
  companyType?: string;
  address?: string;
  officers: CompanyOfficer[];
  industry?: string;
  source: string;
}

export interface CompanyOfficer {
  name: string;
  role: string;
  appointedDate?: string;
  nationality?: string;
}

export interface CompanySearchResult {
  query: string;
  companies: CompanyInfo[];
  stats: { total: number; sourcesQueried: number };
  timestamp: string;
}

// ── SEC EDGAR Full-Text Search (free, no key) ───────────

export async function searchSecEdgar(query: string): Promise<CompanyInfo[]> {
  const companies: CompanyInfo[] = [];

  try {
    // EDGAR full-text search API (efts)
    const response = await fetch(
      `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(query)}&forms=10-K&dateRange=custom&startdt=2020-01-01&enddt=2030-01-01`,
      {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Panopticon OSINT research@example.com" },
      }
    );
    if (response.ok) {
      const data = await response.json();
      const seen = new Set<string>();
      for (const hit of (data.hits?.hits || []).slice(0, 10)) {
        const name = hit._source?.entity_name || hit._source?.display_names?.[0];
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        companies.push({
          name,
          jurisdiction: "US",
          registrationNumber: hit._source?.entity_id ? `CIK${hit._source.entity_id}` : undefined,
          status: "SEC Filer",
          companyType: hit._source?.form_type,
          officers: [],
          source: "sec-edgar",
        });
      }
    }
  } catch {}

  // Fallback: EDGAR company search API
  if (companies.length === 0) {
    try {
      const response = await fetch(
        `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(query)}&CIK=&type=10-K&dateb=&owner=include&count=10&search_text=&action=getcompany`,
        {
          signal: AbortSignal.timeout(15000),
          headers: { "User-Agent": "Panopticon OSINT research@example.com" },
        }
      );
      if (response.ok) {
        const html = await response.text();
        const matches = html.matchAll(/<td class="company-name">\s*<a[^>]*>([^<]+)<\/a>/gi);
        for (const m of matches) {
          companies.push({ name: m[1].trim(), jurisdiction: "US", officers: [], source: "sec-edgar" });
        }
      }
    } catch {}
  }

  return companies;
}

// ── UK Companies House (scrape search page) ─────────────

export async function searchUkCompanies(query: string): Promise<CompanyInfo[]> {
  const companies: CompanyInfo[] = [];

  try {
    const response = await fetch(
      `https://find-and-update.company-information.service.gov.uk/search?q=${encodeURIComponent(query)}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Panopticon/1.0)" },
      }
    );
    if (response.ok) {
      const html = await response.text();
      // Match company links and names
      const results = html.matchAll(/href="\/company\/([^"]+)"[^>]*>\s*([^<]+)/gi);
      for (const match of results) {
        const name = match[2].trim();
        if (name.length > 2 && !companies.find(c => c.name === name)) {
          companies.push({
            name,
            jurisdiction: "GB",
            registrationNumber: match[1],
            officers: [],
            source: "companies-house",
          });
        }
      }
    }
  } catch {}

  return companies;
}

// ── Wikipedia Company Info (free, always available) ──────

export async function searchWikipedia(query: string): Promise<CompanyInfo[]> {
  const companies: CompanyInfo[] = [];

  try {
    // Wikipedia API — search
    const response = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query + " company")}&format=json&srlimit=5`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (response.ok) {
      const data = await response.json();
      for (const result of (data.query?.search || [])) {
        const snippet = result.snippet?.replace(/<[^>]+>/g, "") || "";
        companies.push({
          name: result.title,
          jurisdiction: undefined,
          status: "Wikipedia Article",
          industry: snippet.slice(0, 150),
          officers: [],
          source: "wikipedia",
        });
      }
    }
  } catch {}

  return companies;
}

// ── DuckDuckGo Instant Answer (free) ────────────────────

export async function searchDdgCompany(query: string): Promise<CompanyInfo | null> {
  try {
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (response.ok) {
      const data = await response.json();
      if (data.AbstractText && data.AbstractText.length > 30) {
        return {
          name: data.Heading || query,
          industry: data.AbstractText.slice(0, 300),
          status: data.AbstractSource || "DuckDuckGo",
          officers: [],
          source: "duckduckgo",
        };
      }
    }
  } catch {}
  return null;
}

// ── Domain → Company Association ────────────────────────

export async function domainToCompany(domain: string): Promise<CompanySearchResult> {
  const clean = domain.replace(/[^a-zA-Z0-9.\-]/g, "");
  const baseName = clean.split(".")[0];

  // Get WHOIS org for better search
  let orgName = baseName;
  try {
    const { whoisLookup } = await import("./domain-recon.js");
    const whois = await whoisLookup(clean);
    if (whois.registrantOrg) orgName = whois.registrantOrg;
  } catch {}

  // Search across databases in parallel
  const [sec, uk, wiki, ddg] = await Promise.all([
    searchSecEdgar(orgName),
    searchUkCompanies(orgName),
    searchWikipedia(orgName),
    searchDdgCompany(orgName),
  ]);

  const allCompanies = [...sec, ...uk, ...wiki];
  if (ddg) allCompanies.unshift(ddg);

  return {
    query: orgName,
    companies: allCompanies,
    stats: { total: allCompanies.length, sourcesQueried: 4 },
    timestamp: new Date().toISOString(),
  };
}
