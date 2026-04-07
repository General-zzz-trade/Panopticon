/**
 * Deep Intel Extraction — full-text NLP analysis, cross-module entity correlation,
 * automatic relationship discovery from unstructured text
 */

import { IntelGraph } from "./data-correlator.js";

// ── Deep Entity Extraction from Free Text ───────────────

export interface DeepEntity {
  text: string;
  type: "person" | "organization" | "domain" | "ip" | "email" | "phone" | "money" | "date" | "location" | "technology" | "credential" | "crypto_address";
  confidence: number;
  context: string;  // surrounding text for verification
}

export interface DeepRelation {
  entity1: string;
  entity2: string;
  relationType: string;
  evidence: string;
  confidence: number;
}

export interface DeepExtractionResult {
  source: string;
  entities: DeepEntity[];
  relations: DeepRelation[];
  summary: {
    totalEntities: number;
    byType: Record<string, number>;
    keyFindings: string[];
  };
}

// ── Extraction Patterns ─────────────────────────────────

const ENTITY_PATTERNS: { type: DeepEntity["type"]; patterns: RegExp[] }[] = [
  {
    type: "person",
    patterns: [
      // "CEO John Smith", "founder Jane Doe", "Dr. Smith"
      /(?:CEO|CTO|CFO|founder|president|director|chairman|manager|engineer|researcher|analyst|professor|Dr\.|Mr\.|Mrs\.|Ms\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g,
      // "John Smith said", "John Smith, the"
      /([A-Z][a-z]+\s+[A-Z][a-z]+)(?:\s+(?:said|told|announced|revealed|confirmed|denied|stated|claimed))/g,
    ],
  },
  {
    type: "organization",
    patterns: [
      /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+(?:Inc\.|Corp\.|Ltd\.|LLC|GmbH|S\.A\.|Co\.|Group|Holdings|Technologies|Systems|Solutions|Networks|Labs|Foundation)/g,
      /(?:公司|集团|科技|网络|控股|有限|股份)\s*/g,
    ],
  },
  {
    type: "domain",
    patterns: [/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|co|dev|app|gov|edu|mil)\b/gi],
  },
  {
    type: "ip",
    patterns: [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
  },
  {
    type: "email",
    patterns: [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g],
  },
  {
    type: "phone",
    patterns: [/(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g],
  },
  {
    type: "money",
    patterns: [
      /\$[\d,]+(?:\.\d+)?(?:\s*(?:million|billion|trillion|M|B|T|K))?/gi,
      /[\d,]+(?:\.\d+)?\s*(?:美元|人民币|欧元|英镑|日元|亿|万)/g,
      /€[\d,]+(?:\.\d+)?/g, /£[\d,]+(?:\.\d+)?/g,
    ],
  },
  {
    type: "date",
    patterns: [
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/g,
      /\b\d{4}[-/]\d{2}[-/]\d{2}\b/g,
      /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g,
    ],
  },
  {
    type: "location",
    patterns: [
      /\b(?:New York|San Francisco|Silicon Valley|Washington|London|Tokyo|Beijing|Shanghai|Hong Kong|Singapore|Dubai|Berlin|Paris|Sydney|Toronto|Seoul|Mumbai|São Paulo|Tel Aviv|Zürich|Amsterdam)\b/g,
      /(?:北京|上海|深圳|广州|杭州|成都|南京|武汉|西安|香港|台北|东京|首尔|新加坡|硅谷|华尔街)/g,
    ],
  },
  {
    type: "technology",
    patterns: [
      /\b(?:Python|Java|JavaScript|TypeScript|Go|Rust|C\+\+|Ruby|PHP|Swift|Kotlin)\b/g,
      /\b(?:React|Vue|Angular|Node\.js|Django|Flask|Spring|Rails|Laravel|FastAPI|Express)\b/g,
      /\b(?:AWS|GCP|Azure|Kubernetes|Docker|Terraform|Jenkins|GitHub Actions|CircleCI)\b/g,
      /\b(?:PostgreSQL|MySQL|MongoDB|Redis|Elasticsearch|Kafka|RabbitMQ|GraphQL|REST API)\b/g,
    ],
  },
  {
    type: "credential",
    patterns: [
      /(?:password|passwd|pwd|token|secret|api.key|access.key)\s*[:=]\s*['"]?(\S{8,})/gi,
      /AKIA[0-9A-Z]{16}/g,
      /ghp_[A-Za-z0-9_]{36,}/g,
    ],
  },
  {
    type: "crypto_address",
    patterns: [
      /\b(?:1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,39}\b/g,  // Bitcoin
      /\b0x[a-fA-F0-9]{40}\b/g,                        // Ethereum
    ],
  },
];

// ── Extract Entities from Text ──────────────────────────

export function deepExtractEntities(text: string, source = "unknown"): DeepEntity[] {
  const entities: DeepEntity[] = [];
  const seen = new Set<string>();

  for (const { type, patterns } of ENTITY_PATTERNS) {
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      const matches = text.matchAll(regex);

      for (const match of matches) {
        const value = (match[1] || match[0]).trim();
        if (value.length < 3 || value.length > 200) continue;

        const key = `${type}:${value.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Get surrounding context (30 chars each side)
        const idx = match.index || 0;
        const context = text.slice(Math.max(0, idx - 40), Math.min(text.length, idx + value.length + 40)).replace(/\n/g, " ");

        entities.push({
          text: value,
          type,
          confidence: type === "email" || type === "ip" || type === "domain" ? 0.95 : type === "person" ? 0.6 : 0.7,
          context,
        });
      }
    }
  }

  return entities;
}

// ── Discover Relations from Text ────────────────────────

const RELATION_PATTERNS: { pattern: RegExp; type: string }[] = [
  { pattern: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:is|was|serves as|works at|joined|left|founded|co-founded)\s+(?:the\s+)?(?:CEO|CTO|CFO|founder|president|director|VP|head)\s+(?:of|at)\s+([A-Z][a-zA-Z\s]+(?:Inc|Corp|Ltd|LLC|Co)?)/gi, type: "works_at" },
  { pattern: /([A-Z][a-zA-Z\s]+(?:Inc|Corp|Ltd))\s+(?:acquired|bought|merged with|partnered with|invested in)\s+([A-Z][a-zA-Z\s]+(?:Inc|Corp|Ltd)?)/gi, type: "business_relation" },
  { pattern: /([A-Z][a-zA-Z\s]+)\s+(?:is based in|headquartered in|located in|operates from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi, type: "located_in" },
  { pattern: /([a-zA-Z0-9.-]+\.[a-z]{2,})\s+(?:is owned by|belongs to|operated by|registered to)\s+([A-Z][a-zA-Z\s]+)/gi, type: "owned_by" },
];

export function discoverRelations(text: string): DeepRelation[] {
  const relations: DeepRelation[] = [];

  for (const { pattern, type } of RELATION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const matches = text.matchAll(regex);
    for (const match of matches) {
      if (match[1] && match[2]) {
        relations.push({
          entity1: match[1].trim(),
          entity2: match[2].trim(),
          relationType: type,
          evidence: match[0].trim().slice(0, 150),
          confidence: 0.6,
        });
      }
    }
  }

  return relations;
}

// ── Cross-Module Entity Correlation ─────────────────────

export interface CorrelationResult {
  mergedEntities: { value: string; type: string; seenIn: string[]; count: number }[];
  crossLinks: { entity: string; modules: string[]; significance: string }[];
  keyInsights: string[];
}

export function correlateFindings(moduleResults: Record<string, any>): CorrelationResult {
  const entityTracker = new Map<string, { type: string; seenIn: Set<string>; count: number }>();

  // Extract entities from each module's results
  for (const [moduleName, data] of Object.entries(moduleResults)) {
    const entities = extractEntitiesFromModule(moduleName, data);
    for (const e of entities) {
      const key = `${e.type}:${e.value.toLowerCase()}`;
      const existing = entityTracker.get(key) || { type: e.type, seenIn: new Set(), count: 0 };
      existing.seenIn.add(moduleName);
      existing.count++;
      entityTracker.set(key, existing);
    }
  }

  // Find cross-module entities (appear in 2+ modules = significant)
  const crossLinks: CorrelationResult["crossLinks"] = [];
  const keyInsights: string[] = [];

  for (const [key, data] of entityTracker) {
    if (data.seenIn.size >= 2) {
      const value = key.split(":").slice(1).join(":");
      const modules = [...data.seenIn];
      const significance = data.seenIn.size >= 3 ? "high" : "medium";

      crossLinks.push({ entity: `${data.type}:${value}`, modules, significance });

      if (significance === "high") {
        keyInsights.push(`"${value}" (${data.type}) appears across ${modules.length} modules: ${modules.join(", ")} — likely a central entity`);
      }
    }
  }

  const mergedEntities = Array.from(entityTracker.entries())
    .map(([key, data]) => ({
      value: key.split(":").slice(1).join(":"),
      type: data.type,
      seenIn: [...data.seenIn],
      count: data.count,
    }))
    .sort((a, b) => b.count - a.count);

  return { mergedEntities: mergedEntities.slice(0, 100), crossLinks, keyInsights };
}

function extractEntitiesFromModule(module: string, data: any): { type: string; value: string }[] {
  const entities: { type: string; value: string }[] = [];
  if (!data) return entities;

  // Domain module
  if (data.whois?.registrar) entities.push({ type: "organization", value: data.whois.registrar });
  if (data.whois?.registrantOrg) entities.push({ type: "organization", value: data.whois.registrantOrg });
  for (const sub of (data.subdomains || [])) entities.push({ type: "domain", value: sub.subdomain || sub });
  for (const dns of (data.dns || [])) {
    if (dns.type === "A") entities.push({ type: "ip", value: dns.value });
    if (dns.type === "MX") entities.push({ type: "domain", value: dns.value });
  }

  // Network module
  if (data.resolvedIp) entities.push({ type: "ip", value: data.resolvedIp });
  if (data.geo?.country) entities.push({ type: "location", value: data.geo.country });
  if (data.geo?.org) entities.push({ type: "organization", value: data.geo.org });
  if (data.geo?.isp) entities.push({ type: "organization", value: data.geo.isp });

  // Identity module
  for (const p of (data.foundProfiles || [])) entities.push({ type: "url", value: p.url });

  // Web module
  if (data.techStack?.server) entities.push({ type: "technology", value: data.techStack.server });
  for (const js of (data.techStack?.javascript || [])) entities.push({ type: "technology", value: js });

  // Generic: look for common fields
  if (typeof data === "object") {
    const json = JSON.stringify(data);
    const emails = json.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    const ips = json.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
    emails.forEach(e => entities.push({ type: "email", value: e }));
    ips.forEach(ip => entities.push({ type: "ip", value: ip }));
  }

  return entities;
}

// ── Full Deep Analysis ──────────────────────────────────

export async function deepAnalyze(
  text: string,
  source = "document"
): Promise<DeepExtractionResult> {
  const entities = deepExtractEntities(text, source);
  const relations = discoverRelations(text);

  const byType: Record<string, number> = {};
  for (const e of entities) byType[e.type] = (byType[e.type] || 0) + 1;

  const keyFindings: string[] = [];
  const credentials = entities.filter(e => e.type === "credential");
  if (credentials.length > 0) keyFindings.push(`⚠ ${credentials.length} potential credential(s) found`);
  const cryptoAddrs = entities.filter(e => e.type === "crypto_address");
  if (cryptoAddrs.length > 0) keyFindings.push(`${cryptoAddrs.length} cryptocurrency address(es) found`);
  if (relations.length > 0) keyFindings.push(`${relations.length} entity relationship(s) discovered`);

  return {
    source,
    entities,
    relations,
    summary: {
      totalEntities: entities.length,
      byType,
      keyFindings,
    },
  };
}
