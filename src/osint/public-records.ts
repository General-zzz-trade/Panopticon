/**
 * Public Records — academic papers, patents
 * Free APIs: OpenAlex (academic, unlimited free), Google Patents XHR
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

// ── OpenAlex (free, no key, no rate limit) ──────────────

export async function searchAcademicPapers(query: string, limit = 10): Promise<AcademicResult> {
  const papers: AcademicPaper[] = [];
  const authorMap = new Map<string, AuthorProfile>();

  // Source 1: OpenAlex (completely free, unlimited, no key)
  try {
    const response = await fetch(
      `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${limit}&sort=cited_by_count:desc&mailto=panopticon@example.com`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (response.ok) {
      const data = await response.json();
      for (const work of (data.results || [])) {
        const authors = (work.authorships || []).map((a: any) => a.author?.display_name).filter(Boolean);

        papers.push({
          title: work.title || "",
          authors,
          year: work.publication_year,
          venue: work.primary_location?.source?.display_name,
          abstract: work.abstract_inverted_index ? reconstructAbstract(work.abstract_inverted_index) : undefined,
          citationCount: work.cited_by_count || 0,
          url: work.primary_location?.landing_page_url || work.id,
          doi: work.doi?.replace("https://doi.org/", ""),
        });

        for (const authorship of (work.authorships || [])) {
          const name = authorship.author?.display_name;
          if (!name) continue;
          const existing = authorMap.get(name) || {
            name, affiliations: [], paperCount: 0, citationCount: 0,
          };
          existing.paperCount++;
          existing.citationCount += work.cited_by_count || 0;
          const inst = authorship.institutions?.[0]?.display_name;
          if (inst && !(existing.affiliations as string[]).includes(inst)) (existing.affiliations as string[]).push(inst);
          authorMap.set(name, existing);
        }
      }
    }
  } catch {}

  // Source 2: Semantic Scholar (backup, rate limited)
  if (papers.length === 0) {
    try {
      await new Promise(r => setTimeout(r, 1000)); // Respect rate limit
      const response = await fetch(
        `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=title,authors,year,venue,citationCount,url`,
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
            citationCount: paper.citationCount || 0,
            url: paper.url,
          });
        }
      }
    } catch {}
  }

  const totalCitations = papers.reduce((s, p) => s + p.citationCount, 0);

  return {
    query,
    papers,
    authors: Array.from(authorMap.values()).sort((a, b) => b.citationCount - a.citationCount).slice(0, 10),
    stats: { totalPapers: papers.length, totalCitations },
    timestamp: new Date().toISOString(),
  };
}

// Reconstruct abstract from OpenAlex inverted index format
function reconstructAbstract(invertedIndex: Record<string, number[]>): string {
  const words: [number, string][] = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words.push([pos, word]);
    }
  }
  words.sort((a, b) => a[0] - b[0]);
  return words.map(w => w[1]).join(" ").slice(0, 500);
}

// ── Author Lookup (OpenAlex) ────────────────────────────

export async function lookupAuthor(name: string): Promise<AuthorProfile | null> {
  try {
    const response = await fetch(
      `https://api.openalex.org/authors?search=${encodeURIComponent(name)}&per_page=1&mailto=panopticon@example.com`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (response.ok) {
      const data = await response.json();
      const author = data.results?.[0];
      if (author) {
        return {
          name: author.display_name,
          affiliations: author.affiliations?.map((a: any) => a.institution?.display_name).filter(Boolean) || [],
          paperCount: author.works_count || 0,
          citationCount: author.cited_by_count || 0,
          hIndex: author.summary_stats?.h_index,
          url: author.id,
        };
      }
    }
  } catch {}
  return null;
}

// ── Google Patents XHR (free, no key) ───────────────────

export async function searchPatents(query: string, limit = 10): Promise<PatentResult> {
  const patents: Patent[] = [];

  try {
    const response = await fetch(
      `https://patents.google.com/xhr/query?url=q%3D${encodeURIComponent(query)}&exp=&num=${limit}`,
      {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Panopticon/1.0)" },
      }
    );
    if (response.ok) {
      const data = await response.json();
      const results = data.results?.cluster?.[0]?.result || [];

      for (const r of results.slice(0, limit)) {
        const p = r.patent;
        if (!p) continue;

        patents.push({
          title: (p.title || "").replace(/<[^>]+>/g, ""),
          patentNumber: p.publication_number || r.id?.replace("patent/", "").split("/")[0] || "",
          inventors: p.inventor ? [p.inventor] : [],
          assignee: p.assignee,
          filingDate: p.filing_date,
          grantDate: p.grant_date || p.publication_date,
          abstract: (p.snippet || "").replace(/<[^>]+>/g, "").slice(0, 300),
          url: `https://patents.google.com/${r.id || ""}`,
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

// ── Combined Research ───────────────────────────────────

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
