/**
 * Pivot Engine — automatic discovery chain from initial findings
 * Given an entity, automatically discovers related entities and expands the investigation
 *
 * Core concept: each finding triggers relevant follow-up queries
 *   domain → DNS → IPs → reverse IP → co-hosted domains → WHOIS → shared registrant → more domains
 *   email → domain → MX → provider → username → social profiles
 */

import { IntelGraph, type Entity } from "./data-correlator.js";

export interface PivotRule {
  fromType: string;
  toModule: string;
  description: string;
  extract: (entity: Entity, result: any) => { type: string; value: string; metadata?: any }[];
}

export interface PivotResult {
  seed: { type: string; value: string };
  depth: number;
  graph: ReturnType<IntelGraph["toJSON"]>;
  discoveries: PivotDiscovery[];
  pivotChain: string[];  // Human-readable chain of pivots
  stats: {
    totalEntities: number;
    totalRelations: number;
    pivotsPerformed: number;
    newEntitiesFound: number;
    durationMs: number;
  };
  timestamp: string;
}

export interface PivotDiscovery {
  fromEntity: string;
  pivotType: string;
  discovered: { type: string; value: string }[];
  durationMs: number;
}

// ── Pivot Rules ─────────────────────────────────────────

const PIVOT_RULES: PivotRule[] = [
  // Domain → DNS A records → IPs
  {
    fromType: "domain",
    toModule: "dns-to-ip",
    description: "Resolve domain to IPs",
    extract: (entity, result) => {
      if (!Array.isArray(result)) return [];
      return result
        .filter((r: any) => r.type === "A" || r.type === "AAAA")
        .map((r: any) => ({ type: "ip", value: r.value }));
    },
  },

  // Domain → WHOIS → registrant email/org
  {
    fromType: "domain",
    toModule: "whois-to-registrant",
    description: "Extract WHOIS registrant info",
    extract: (entity, result) => {
      const entities: { type: string; value: string; metadata?: any }[] = [];
      if (result.registrantOrg) entities.push({ type: "organization", value: result.registrantOrg });
      if (result.registrant) entities.push({ type: "person", value: result.registrant });
      if (result.registrantCountry) entities.push({ type: "country", value: result.registrantCountry });
      for (const ns of result.nameServers || []) {
        entities.push({ type: "nameserver", value: ns });
      }
      return entities;
    },
  },

  // Domain → MX → mail provider
  {
    fromType: "domain",
    toModule: "dns-to-mx",
    description: "Extract mail infrastructure",
    extract: (entity, result) => {
      if (!Array.isArray(result)) return [];
      return result
        .filter((r: any) => r.type === "MX")
        .map((r: any) => ({ type: "domain", value: r.value, metadata: { type: "mail-server" } }));
    },
  },

  // IP → reverse IP → co-hosted domains
  {
    fromType: "ip",
    toModule: "reverse-ip",
    description: "Find co-hosted domains on same IP",
    extract: (entity, result) => {
      return (result.domains || []).map((d: string) => ({ type: "domain", value: d }));
    },
  },

  // IP → ASN → network owner
  {
    fromType: "ip",
    toModule: "asn-lookup",
    description: "Identify network owner via ASN",
    extract: (entity, result) => {
      const entities: { type: string; value: string; metadata?: any }[] = [];
      if (result.asn) entities.push({ type: "asn", value: result.asn, metadata: { name: result.name, cidr: result.cidr } });
      if (result.name) entities.push({ type: "organization", value: result.name });
      return entities;
    },
  },

  // IP → GeoIP → location
  {
    fromType: "ip",
    toModule: "geoip",
    description: "Geolocate IP",
    extract: (entity, result) => {
      const entities: { type: string; value: string }[] = [];
      if (result.country) entities.push({ type: "country", value: result.country });
      if (result.org) entities.push({ type: "organization", value: result.org });
      return entities;
    },
  },

  // Email → domain + username
  {
    fromType: "email",
    toModule: "email-split",
    description: "Split email into domain and username",
    extract: (entity) => {
      const parts = entity.value.split("@");
      const entities: { type: string; value: string }[] = [];
      if (parts[0]) entities.push({ type: "username", value: parts[0] });
      if (parts[1]) entities.push({ type: "domain", value: parts[1] });
      return entities;
    },
  },

  // Nameserver → extract base domain (shared hosting indicator)
  {
    fromType: "nameserver",
    toModule: "ns-to-provider",
    description: "Identify hosting provider from nameserver",
    extract: (entity) => {
      const ns = entity.value.toLowerCase();
      const providers: Record<string, string> = {
        "cloudflare": "Cloudflare", "awsdns": "AWS Route53", "nsone": "NS1",
        "google": "Google Cloud DNS", "azure": "Azure DNS", "godaddy": "GoDaddy",
        "domaincontrol": "GoDaddy", "registrar-servers": "Namecheap",
      };
      for (const [pattern, name] of Object.entries(providers)) {
        if (ns.includes(pattern)) {
          return [{ type: "organization", value: name, metadata: { type: "dns-provider" } }];
        }
      }
      return [];
    },
  },

  // ── Deep Pivot Rules (Level 2+) ─────────────────────

  // Domain → Certificate SANs → related domains
  {
    fromType: "domain",
    toModule: "cert-san-pivot",
    description: "Find related domains via certificate SANs",
    extract: (entity, result) => {
      return (result.sanNames || [])
        .filter((san: string) => san !== entity.value && san.includes(".") && !san.startsWith("*"))
        .map((san: string) => ({ type: "domain", value: san, metadata: { source: "certificate-san" } }));
    },
  },

  // Domain → SPF includes → partner infrastructure
  {
    fromType: "domain",
    toModule: "spf-include-pivot",
    description: "Discover partner services via SPF includes",
    extract: (entity, result) => {
      return (result.includes || [])
        .map((inc: string) => ({ type: "domain", value: inc, metadata: { relation: "spf-include" } }));
    },
  },

  // Domain → tech stack → technology entities
  {
    fromType: "domain",
    toModule: "tech-stack-pivot",
    description: "Identify technology stack",
    extract: (entity, result) => {
      const techs: { type: string; value: string; metadata?: any }[] = [];
      if (result.server) techs.push({ type: "technology", value: result.server });
      for (const js of (result.javascript || [])) techs.push({ type: "technology", value: js });
      if (result.cdn) techs.push({ type: "technology", value: result.cdn, metadata: { type: "cdn" } });
      if (result.hosting) techs.push({ type: "hosting", value: result.hosting });
      return techs;
    },
  },

  // Username → social profile discovery
  {
    fromType: "username",
    toModule: "username-enum",
    description: "Enumerate username across platforms",
    extract: (entity, result) => {
      return (result || [])
        .filter((p: any) => p.exists)
        .map((p: any) => ({ type: "url", value: p.url, metadata: { platform: p.platform } }));
    },
  },

  // Organization → search for company info
  {
    fromType: "organization",
    toModule: "org-to-wiki",
    description: "Lookup organization details",
    extract: (entity, result) => {
      return (result || []).map((c: any) => ({
        type: "organization", value: c.name,
        metadata: { jurisdiction: c.jurisdiction, source: c.source, industry: c.industry },
      }));
    },
  },
];

// ── Pivot Executor ──────────────────────────────────────

async function executePivot(entity: Entity, rule: PivotRule): Promise<{ type: string; value: string; metadata?: any }[]> {
  const val = entity.value;

  switch (rule.toModule) {
    case "dns-to-ip":
    case "dns-to-mx": {
      const { dnsLookup } = await import("./domain-recon.js");
      const types = rule.toModule === "dns-to-mx" ? ["MX"] : ["A", "AAAA"];
      const records = await dnsLookup(val, types);
      return rule.extract(entity, records);
    }
    case "whois-to-registrant": {
      const { whoisLookup } = await import("./domain-recon.js");
      const whois = await whoisLookup(val);
      return rule.extract(entity, whois);
    }
    case "reverse-ip": {
      const { reverseIpLookup } = await import("./reverse-ip.js");
      const result = await reverseIpLookup(val);
      return rule.extract(entity, result);
    }
    case "asn-lookup": {
      const { asnLookup } = await import("./reverse-ip.js");
      const result = await asnLookup(val);
      return rule.extract(entity, result);
    }
    case "geoip": {
      const { geolocateIp } = await import("./network-recon.js");
      const result = await geolocateIp(val);
      return rule.extract(entity, result);
    }
    case "email-split":
    case "ns-to-provider":
      return rule.extract(entity, null);
    case "cert-san-pivot": {
      const { sslDeepAnalysis } = await import("./advanced-recon.js");
      const ssl = await sslDeepAnalysis(val);
      return rule.extract(entity, ssl);
    }
    case "spf-include-pivot": {
      const { execFileNoThrow } = await import("../utils/execFileNoThrow.js");
      const { stdout } = await execFileNoThrow("dig", ["+short", val, "TXT"], { timeoutMs: 5000 });
      const spfLine = stdout.split("\n").find(l => l.includes("v=spf1")) || "";
      const includes = (spfLine.match(/include:(\S+)/g) || []).map(m => m.replace("include:", ""));
      return rule.extract(entity, { includes });
    }
    case "tech-stack-pivot": {
      const { detectTechStack } = await import("./web-intel.js");
      const url = val.startsWith("http") ? val : `https://${val}`;
      const tech = await detectTechStack(url);
      return rule.extract(entity, tech);
    }
    case "username-enum": {
      const { enumerateUsername } = await import("./identity-recon.js");
      const results = await enumerateUsername(val, { categories: ["dev"], concurrency: 3 });
      return rule.extract(entity, results);
    }
    case "org-to-wiki": {
      const { searchWikipedia } = await import("./company-intel.js");
      return rule.extract(entity, await searchWikipedia(val));
    }
    default:
      return [];
  }
}

// ── Main Pivot Engine ───────────────────────────────────

export async function autoPivot(
  seedType: string,
  seedValue: string,
  options: { maxDepth?: number; maxEntities?: number; maxPivots?: number } = {}
): Promise<PivotResult> {
  const maxDepth = options.maxDepth ?? 3;
  const maxEntities = options.maxEntities ?? 100;
  const maxPivots = options.maxPivots ?? 20;
  const start = Date.now();

  const graph = new IntelGraph();
  const discoveries: PivotDiscovery[] = [];
  const pivotChain: string[] = [];
  let pivotsPerformed = 0;
  let newEntitiesFound = 0;

  // Queue: entities to process, with depth tracking
  const queue: { entity: Entity; depth: number }[] = [];
  const processed = new Set<string>();

  // Seed entity
  const seed = graph.addEntity(seedType as any, seedValue, {}, "seed");
  queue.push({ entity: seed, depth: 0 });

  while (queue.length > 0 && pivotsPerformed < maxPivots) {
    const { entity, depth } = queue.shift()!;
    const key = `${entity.type}:${entity.value}`;

    if (processed.has(key) || depth > maxDepth) continue;
    processed.add(key);

    // Find applicable pivot rules
    const rules = PIVOT_RULES.filter(r => r.fromType === entity.type);

    for (const rule of rules) {
      if (pivotsPerformed >= maxPivots) break;
      if (graph.export().entities.size >= maxEntities) break;

      const pivotStart = Date.now();
      pivotsPerformed++;

      try {
        const newEntities = await executePivot(entity, rule);
        const discovery: PivotDiscovery = {
          fromEntity: `${entity.type}:${entity.value}`,
          pivotType: rule.toModule,
          discovered: [],
          durationMs: Date.now() - pivotStart,
        };

        for (const ne of newEntities) {
          if (!ne.value || ne.value.length < 2) continue;

          const newEntity = graph.addEntity(ne.type as any, ne.value, ne.metadata || {}, rule.toModule);
          const relType = rule.toModule.includes("reverse") ? "hosts" :
            rule.toModule.includes("whois") ? "registered_by" :
            rule.toModule.includes("dns") ? "resolves_to" :
            rule.toModule.includes("asn") ? "belongs_to" :
            rule.toModule.includes("geoip") ? "located_in" :
            "associated_with";

          graph.addRelation(entity, newEntity, relType as any, {}, rule.toModule);

          // Only queue truly new entities for further pivoting
          const newKey = `${ne.type}:${ne.value}`;
          if (!processed.has(newKey)) {
            queue.push({ entity: newEntity, depth: depth + 1 });
            discovery.discovered.push({ type: ne.type, value: ne.value });
            newEntitiesFound++;
          }
        }

        if (discovery.discovered.length > 0) {
          discoveries.push(discovery);
          pivotChain.push(`${entity.value} → [${rule.description}] → ${discovery.discovered.map(d => d.value).join(", ")}`);
        }
      } catch {}
    }
  }

  const graphData = graph.toJSON() as any;

  return {
    seed: { type: seedType, value: seedValue },
    depth: maxDepth,
    graph: graphData,
    discoveries,
    pivotChain,
    stats: {
      totalEntities: graphData.stats.entityCount,
      totalRelations: graphData.stats.relationCount,
      pivotsPerformed,
      newEntitiesFound,
      durationMs: Date.now() - start,
    },
    timestamp: new Date().toISOString(),
  };
}
