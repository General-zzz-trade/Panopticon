/**
 * Company Intelligence — corporate registry, ownership, financial data
 * Uses free public APIs: OpenCorporates, SEC EDGAR, UK Companies House
 */

export interface CompanyInfo {
  name: string;
  jurisdiction?: string;
  registrationNumber?: string;
  status?: string;        // Active, Dissolved, etc.
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

// ── OpenCorporates (free, no key, limited results) ──────

export async function searchOpenCorporates(query: string): Promise<CompanyInfo[]> {
  const companies: CompanyInfo[] = [];

  try {
    const response = await fetch(
      `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(query)}&per_page=10`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (response.ok) {
      const data = await response.json();
      for (const result of (data.results?.companies || [])) {
        const c = result.company;
        companies.push({
          name: c.name,
          jurisdiction: c.jurisdiction_code,
          registrationNumber: c.company_number,
          status: c.current_status,
          incorporationDate: c.incorporation_date,
          companyType: c.company_type,
          address: c.registered_address_in_full,
          officers: [],
          industry: c.industry_codes?.map((ic: any) => ic.industry_code?.description).filter(Boolean).join(", "),
          source: "opencorporates",
        });
      }
    }
  } catch {}

  return companies;
}

// ── SEC EDGAR (US public companies — free) ──────────────

export async function searchSecEdgar(query: string): Promise<CompanyInfo[]> {
  const companies: CompanyInfo[] = [];

  try {
    const response = await fetch(
      `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(query)}&dateRange=custom&startdt=2020-01-01&enddt=2030-01-01&forms=10-K`,
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
        if (!name || seen.has(name)) continue;
        seen.add(name);
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

  // Also try the full-text search
  if (companies.length === 0) {
    try {
      const response = await fetch(
        `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(query)}&forms=10-K,10-Q,8-K`,
        {
          signal: AbortSignal.timeout(10000),
          headers: { "User-Agent": "Panopticon OSINT research@example.com" },
        }
      );
      if (response.ok) {
        const data = await response.json();
        for (const hit of (data.hits?.hits || []).slice(0, 5)) {
          const name = hit._source?.entity_name;
          if (name) companies.push({ name, jurisdiction: "US", officers: [], source: "sec-edgar" });
        }
      }
    } catch {}
  }

  return companies;
}

// ── UK Companies House (free API, no key for basic search) ─

export async function searchUkCompanies(query: string): Promise<CompanyInfo[]> {
  const companies: CompanyInfo[] = [];

  try {
    const response = await fetch(
      `https://find-and-update.company-information.service.gov.uk/search?q=${encodeURIComponent(query)}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0" },
      }
    );
    if (response.ok) {
      const html = await response.text();
      // Parse search results from HTML
      const results = html.matchAll(/<a class="govuk-link"[^>]*href="\/company\/(\d+)"[^>]*>([^<]+)<\/a>/gi);
      for (const match of results) {
        companies.push({
          name: match[2].trim(),
          jurisdiction: "GB",
          registrationNumber: match[1],
          officers: [],
          source: "companies-house",
        });
      }
    }
  } catch {}

  return companies;
}

// ── Domain → Company Association ────────────────────────

export async function domainToCompany(domain: string): Promise<CompanySearchResult> {
  const clean = domain.replace(/[^a-zA-Z0-9.\-]/g, "");
  const baseName = clean.split(".")[0]; // e.g. "github" from "github.com"

  // Get WHOIS org for better search
  let orgName = baseName;
  try {
    const { whoisLookup } = await import("./domain-recon.js");
    const whois = await whoisLookup(clean);
    if (whois.registrantOrg) orgName = whois.registrantOrg;
  } catch {}

  // Search across corporate databases
  const [oc, sec, uk] = await Promise.all([
    searchOpenCorporates(orgName),
    searchSecEdgar(orgName),
    searchUkCompanies(orgName),
  ]);

  const allCompanies = [...oc, ...sec, ...uk];

  return {
    query: orgName,
    companies: allCompanies,
    stats: { total: allCompanies.length, sourcesQueried: 3 },
    timestamp: new Date().toISOString(),
  };
}
