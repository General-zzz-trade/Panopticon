/**
 * Public Records — academic papers, patents, court records
 * Free APIs: Semantic Scholar, USPTO, PACER (limited), Google Scholar (scrape)
 */

export interface AcademicResult {
  query: string;
  papers: AcademicPaper[];
  authors: AuthorProfile[];
  stats: { totalPapers: number; totalCitations: number };
  timestamp: string;
}

export interface AcademicPaper {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  citationCount: number;
  url?: string;
  doi?: string;
}

export interface AuthorProfile {
  name: string;
  affiliations: string[];
  paperCount: number;
  citationCount: number;
  hIndex?: number;
  url?: string;
}

export interface PatentResult {
  query: string;
  patents: Patent[];
  stats: { total: number };
  timestamp: string;
}

export interface Patent {
  title: string;
  patentNumber: string;
  inventors: string[];
  assignee?: string;
  filingDate?: string;
  grantDate?: string;
  abstract?: string;
  url: string;
}

// ── Semantic Scholar (free API, no key) ─────────────────

export async function searchAcademicPapers(query: string, limit = 10): Promise<AcademicResult> {
  const papers: AcademicPaper[] = [];
  const authorMap = new Map<string, AuthorProfile>();

  try {
    const response = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=title,authors,year,venue,abstract,citationCount,externalIds,url`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (response.ok) {
      const data = await response.json();
      for (const paper of (data.data || [])) {
        papers.push({
          title: paper.title,
          authors: (paper.authors || []).map((a: any) => a.name),
          year: paper.year,
          venue: paper.venue,
          abstract: paper.abstract?.slice(0, 300),
          citationCount: paper.citationCount || 0,
          url: paper.url,
          doi: paper.externalIds?.DOI,
        });

        // Build author profiles
        for (const author of (paper.authors || [])) {
          const existing = authorMap.get(author.name) || {
            name: author.name, affiliations: [], paperCount: 0, citationCount: 0,
          };
          existing.paperCount++;
          existing.citationCount += paper.citationCount || 0;
          authorMap.set(author.name, existing);
        }
      }
    }
  } catch {}

  const totalCitations = papers.reduce((s, p) => s + p.citationCount, 0);

  return {
    query,
    papers,
    authors: Array.from(authorMap.values()).sort((a, b) => b.citationCount - a.citationCount).slice(0, 10),
    stats: { totalPapers: papers.length, totalCitations },
    timestamp: new Date().toISOString(),
  };
}

// ── Author Lookup ───────────────────────────────────────

export async function lookupAuthor(name: string): Promise<AuthorProfile | null> {
  try {
    const response = await fetch(
      `https://api.semanticscholar.org/graph/v1/author/search?query=${encodeURIComponent(name)}&limit=1&fields=name,affiliations,paperCount,citationCount,hIndex,url`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (response.ok) {
      const data = await response.json();
      const author = data.data?.[0];
      if (author) {
        return {
          name: author.name,
          affiliations: author.affiliations || [],
          paperCount: author.paperCount || 0,
          citationCount: author.citationCount || 0,
          hIndex: author.hIndex,
          url: author.url,
        };
      }
    }
  } catch {}
  return null;
}

// ── Patent Search (USPTO — free) ────────────────────────

export async function searchPatents(query: string, limit = 10): Promise<PatentResult> {
  const patents: Patent[] = [];

  // USPTO PatentsView API (free, no key)
  try {
    const response = await fetch(
      `https://api.patentsview.org/patents/query?q={"_text_any":{"patent_abstract":"${query.replace(/"/g, "")}"}}&f=["patent_number","patent_title","patent_abstract","patent_date","assignee_organization","inventor_first_name","inventor_last_name"]&o={"page":1,"per_page":${limit}}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (response.ok) {
      const data = await response.json();
      for (const p of (data.patents || [])) {
        const inventors = (p.inventors || []).map((i: any) => `${i.inventor_first_name} ${i.inventor_last_name}`);
        const assignee = p.assignees?.[0]?.assignee_organization;

        patents.push({
          title: p.patent_title,
          patentNumber: p.patent_number,
          inventors,
          assignee,
          grantDate: p.patent_date,
          abstract: p.patent_abstract?.slice(0, 300),
          url: `https://patents.google.com/patent/US${p.patent_number}`,
        });
      }
    }
  } catch {}

  return {
    query,
    patents,
    stats: { total: patents.length },
    timestamp: new Date().toISOString(),
  };
}

// ── Domain/Company → Academic + Patent Research ─────────

export async function researchEntity(query: string): Promise<{
  academic: AcademicResult;
  patents: PatentResult;
  timestamp: string;
}> {
  const [academic, patents] = await Promise.all([
    searchAcademicPapers(query),
    searchPatents(query),
  ]);

  return { academic, patents, timestamp: new Date().toISOString() };
}
