/**
 * Natural Language Investigator — parse natural language queries into OSINT module chains
 * "Investigate this company" → auto-select domain + identity + web + threat modules
 */

import type { ChainDefinition, ChainStepType } from "./investigation-chain.js";

export interface NlParseResult {
  originalQuery: string;
  targets: string[];
  targetTypes: ("domain" | "ip" | "email" | "username" | "url" | "org")[];
  suggestedChain: ChainDefinition;
  confidence: number;
  reasoning: string;
}

// ── Target Detection Patterns ───────────────────────────

const PATTERNS = {
  domain: /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|co|dev|app|xyz|info|biz|me|us|uk|de|fr|cn|jp|ru|br|in|edu|gov|mil|int|eu|tv|cc|ly|gg|sh)\b/gi,
  ip: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  url: /https?:\/\/[^\s<>"]+/g,
  ipv6: /(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}/g,
};

// ── Intent Keywords ─────────────────────────────────────

const INTENT_MAP: Record<string, ChainStepType[]> = {
  // Investigation scope
  investigate: ["domain_recon", "network_recon", "web_intel", "threat_check"],
  recon: ["domain_recon", "network_recon"],
  scan: ["port_scan", "network_recon"],
  lookup: ["domain_recon"],
  search: ["github_recon", "dork_execute"],
  monitor: ["domain_recon", "network_recon"],

  // Specific modules
  domain: ["domain_recon"],
  dns: ["domain_recon"],
  whois: ["domain_recon"],
  subdomain: ["subdomain_enum"],
  port: ["port_scan"],
  network: ["network_recon"],
  asn: ["asn_lookup"],
  ip: ["network_recon", "asn_lookup"],
  geo: ["network_recon"],
  geolocation: ["network_recon"],

  identity: ["identity_recon"],
  username: ["identity_recon"],
  email: ["identity_recon", "breach_check"],
  profile: ["identity_recon"],
  social: ["identity_recon"],

  web: ["web_intel"],
  technology: ["web_intel"],
  tech: ["web_intel"],
  stack: ["web_intel"],
  wayback: ["web_intel"],
  crawler: ["crawl"],
  crawl: ["crawl"],
  screenshot: ["screenshot"],

  threat: ["threat_check"],
  malware: ["threat_check"],
  phishing: ["threat_check"],
  blacklist: ["threat_check"],
  ssl: ["ssl_analysis"],
  certificate: ["ssl_analysis"],

  breach: ["breach_check"],
  leak: ["breach_check"],
  password: ["breach_check"],
  pwned: ["breach_check"],

  github: ["github_recon"],
  code: ["github_recon"],
  repo: ["github_recon"],
  secret: ["github_recon"],
  dork: ["dork_execute"],
  google: ["dork_execute"],

  document: ["doc_scan"],
  pdf: ["doc_scan"],
  exif: ["doc_scan"],
  metadata: ["doc_scan"],

  // Chinese keywords
  "调查": ["domain_recon", "network_recon", "web_intel", "threat_check"],
  "域名": ["domain_recon"],
  "扫描": ["port_scan", "network_recon"],
  "子域名": ["subdomain_enum"],
  "端口": ["port_scan"],
  "用户名": ["identity_recon"],
  "邮箱": ["identity_recon", "breach_check"],
  "泄露": ["breach_check"],
  "威胁": ["threat_check"],
  "爬虫": ["crawl"],
  "截图": ["screenshot"],
  "技术栈": ["web_intel"],
  "情报": ["domain_recon", "network_recon", "web_intel", "threat_check"],
};

// ── Target Type Detection ───────────────────────────────

function detectTargets(query: string): { targets: string[]; types: NlParseResult["targetTypes"] } {
  const targets: string[] = [];
  const types: NlParseResult["targetTypes"] = [];

  // Email first (contains @)
  const emails = query.match(PATTERNS.email) || [];
  for (const e of emails) { targets.push(e); types.push("email"); }

  // URLs
  const urls = query.match(PATTERNS.url) || [];
  for (const u of urls) { if (!targets.includes(u)) { targets.push(u); types.push("url"); } }

  // IPs
  const ips = query.match(PATTERNS.ip) || [];
  for (const ip of ips) { if (!targets.includes(ip)) { targets.push(ip); types.push("ip"); } }

  // Domains (after removing already-found targets)
  let remaining = query;
  for (const t of targets) remaining = remaining.replace(t, "");
  const domains = remaining.match(PATTERNS.domain) || [];
  for (const d of domains) { if (!targets.includes(d)) { targets.push(d); types.push("domain"); } }

  // If no targets found, treat the last meaningful word as a username
  if (targets.length === 0) {
    const words = query.split(/\s+/).filter(w => w.length >= 3 && !/^(the|and|for|find|check|scan|investigate|look|up|search|about|this|that|what|who|how|show|me|please|can|you|do|run|get|is|are|was)$/i.test(w));
    if (words.length > 0) {
      const last = words[words.length - 1].replace(/[^a-zA-Z0-9._-]/g, "");
      if (last.length >= 2) { targets.push(last); types.push("username"); }
    }
  }

  return { targets, types };
}

// ── Parse Natural Language Query ────────────────────────

export function parseNaturalLanguage(query: string): NlParseResult {
  const lowerQuery = query.toLowerCase();
  const { targets, types } = detectTargets(query);

  // Detect intent from keywords
  const detectedSteps = new Set<ChainStepType>();
  let matchedKeywords = 0;

  for (const [keyword, steps] of Object.entries(INTENT_MAP)) {
    if (lowerQuery.includes(keyword)) {
      matchedKeywords++;
      for (const step of steps) detectedSteps.add(step);
    }
  }

  // If no specific intent detected, auto-select based on target type
  if (detectedSteps.size === 0) {
    for (const type of types) {
      if (type === "domain" || type === "url") {
        detectedSteps.add("domain_recon");
        detectedSteps.add("web_intel");
        detectedSteps.add("threat_check");
      } else if (type === "ip") {
        detectedSteps.add("network_recon");
        detectedSteps.add("asn_lookup");
      } else if (type === "email") {
        detectedSteps.add("identity_recon");
        detectedSteps.add("breach_check");
      } else if (type === "username") {
        detectedSteps.add("identity_recon");
      }
    }
  }

  // Fallback to full investigation
  if (detectedSteps.size === 0) {
    detectedSteps.add("domain_recon");
    detectedSteps.add("network_recon");
    detectedSteps.add("web_intel");
  }

  const steps = Array.from(detectedSteps);
  const confidence = targets.length > 0 ? Math.min(0.95, 0.5 + matchedKeywords * 0.1) : 0.3;

  const chain: ChainDefinition = {
    name: `NL: ${query.slice(0, 50)}`,
    description: `Auto-generated from natural language query`,
    steps: steps.map((type, i) => ({ id: `step_${i}`, type })),
  };

  const reasoning = `Detected ${targets.length} target(s): [${targets.join(", ")}] (${types.join(", ")}). ` +
    `Matched ${matchedKeywords} intent keyword(s). ` +
    `Selected ${steps.length} module(s): ${steps.join(" → ")}`;

  return {
    originalQuery: query,
    targets,
    targetTypes: types,
    suggestedChain: chain,
    confidence,
    reasoning,
  };
}
