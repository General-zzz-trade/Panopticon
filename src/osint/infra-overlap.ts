/**
 * Infrastructure Overlap Detection — find hidden connections between targets
 * Compares DNS, IP, NS, registrar, certificates, ASN to identify shared infrastructure
 */

import { execFileNoThrow } from "../utils/execFileNoThrow.js";

export interface OverlapResult {
  targets: string[];
  overlaps: InfraOverlap[];
  sharedEntities: SharedEntity[];
  connectionStrength: number;  // 0-100
  verdict: "same_owner" | "same_provider" | "coincidental" | "unrelated";
  reasoning: string[];
  timestamp: string;
}

export interface InfraOverlap {
  type: "ip" | "nameserver" | "mx" | "registrar" | "asn" | "cidr" | "certificate" | "technology" | "hosting";
  values: string[];  // shared values
  targets: string[]; // which targets share this
  significance: "high" | "medium" | "low";
}

export interface SharedEntity {
  type: string;
  value: string;
  sharedBy: string[];
}

interface TargetProfile {
  domain: string;
  ips: string[];
  nameservers: string[];
  mxRecords: string[];
  registrar?: string;
  registrantOrg?: string;
  asns: string[];
  cidrs: string[];
  technologies: string[];
}

// ── Collect Target Profile ──────────────────────────────

async function collectProfile(domain: string): Promise<TargetProfile> {
  const clean = domain.replace(/[^a-zA-Z0-9.\-]/g, "");
  const profile: TargetProfile = {
    domain: clean,
    ips: [], nameservers: [], mxRecords: [], asns: [], cidrs: [], technologies: [],
  };

  // DNS: A, NS, MX
  const { dnsLookup } = await import("./domain-recon.js");
  const records = await dnsLookup(clean, ["A", "NS", "MX"]);

  for (const r of records) {
    if (r.type === "A") profile.ips.push(r.value);
    if (r.type === "NS") profile.nameservers.push(r.value.replace(/\.$/, "").toLowerCase());
    if (r.type === "MX") profile.mxRecords.push(r.value.replace(/\.$/, "").toLowerCase());
  }

  // WHOIS
  const { whoisLookup } = await import("./domain-recon.js");
  const whois = await whoisLookup(clean);
  profile.registrar = whois.registrar;
  profile.registrantOrg = whois.registrantOrg;

  // ASN for each IP
  const { asnLookup } = await import("./reverse-ip.js");
  for (const ip of profile.ips.slice(0, 3)) {
    try {
      const asn = await asnLookup(ip);
      if (asn.asn) profile.asns.push(asn.asn);
      if (asn.cidr) profile.cidrs.push(asn.cidr);
    } catch {}
  }

  // Tech stack
  try {
    const { detectTechStack } = await import("./web-intel.js");
    const tech = await detectTechStack(`https://${clean}`);
    if (tech.server) profile.technologies.push(tech.server);
    if (tech.cdn) profile.technologies.push(tech.cdn);
    if (tech.hosting) profile.technologies.push(tech.hosting);
    profile.technologies.push(...tech.javascript);
  } catch {}

  return profile;
}

// ── Compare Two Profiles ────────────────────────────────

function findOverlaps(profiles: TargetProfile[]): InfraOverlap[] {
  const overlaps: InfraOverlap[] = [];

  const check = (
    type: InfraOverlap["type"],
    significance: InfraOverlap["significance"],
    extractor: (p: TargetProfile) => string[]
  ) => {
    const valueSets = profiles.map(p => new Set(extractor(p)));
    const allValues = new Set(profiles.flatMap(extractor));

    for (const value of allValues) {
      const sharedBy = profiles.filter((_, i) => valueSets[i].has(value)).map(p => p.domain);
      if (sharedBy.length >= 2) {
        overlaps.push({ type, values: [value], targets: sharedBy, significance });
      }
    }
  };

  check("ip", "high", p => p.ips);
  check("nameserver", "medium", p => p.nameservers);
  check("mx", "medium", p => p.mxRecords);
  check("asn", "low", p => p.asns);
  check("cidr", "medium", p => p.cidrs);
  check("technology", "low", p => p.technologies);

  // Check registrar overlap (same registrar is less significant but same org is high)
  const registrars = profiles.map(p => p.registrar?.toLowerCase()).filter(Boolean);
  if (registrars.length >= 2 && new Set(registrars).size === 1) {
    overlaps.push({ type: "registrar", values: [registrars[0]!], targets: profiles.map(p => p.domain), significance: "low" });
  }

  // Registrant org overlap — HIGH significance
  const orgs = profiles.map(p => p.registrantOrg?.toLowerCase()).filter(Boolean);
  if (orgs.length >= 2 && new Set(orgs).size === 1) {
    overlaps.push({ type: "registrar", values: [orgs[0]!], targets: profiles.map(p => p.domain), significance: "high" });
  }

  return overlaps;
}

// ── Calculate Connection Strength ───────────────────────

function calculateStrength(overlaps: InfraOverlap[]): { score: number; verdict: OverlapResult["verdict"]; reasoning: string[] } {
  let score = 0;
  const reasoning: string[] = [];

  for (const o of overlaps) {
    if (o.type === "ip" && o.significance === "high") {
      score += 30;
      reasoning.push(`Shared IP address: ${o.values[0]} (strong indicator of same host)`);
    }
    if (o.type === "nameserver") {
      // Same NS could mean same provider (weak) or same account (medium)
      score += 10;
      reasoning.push(`Shared nameserver: ${o.values[0]}`);
    }
    if (o.type === "mx") {
      score += 15;
      reasoning.push(`Shared mail server: ${o.values[0]} (likely same organization)`);
    }
    if (o.type === "cidr") {
      score += 20;
      reasoning.push(`Same IP block: ${o.values[0]} (likely same cloud account)`);
    }
    if (o.type === "registrar" && o.significance === "high") {
      score += 35;
      reasoning.push(`Same registrant organization: ${o.values[0]} (strong indicator of same owner)`);
    }
    if (o.type === "registrar" && o.significance === "low") {
      score += 5;
      reasoning.push(`Same registrar: ${o.values[0]} (weak — same provider)`);
    }
    if (o.type === "asn") {
      score += 5;
      reasoning.push(`Same ASN: ${o.values[0]} (shared ISP/cloud provider)`);
    }
    if (o.type === "technology") {
      score += 2;
      reasoning.push(`Shared technology: ${o.values[0]}`);
    }
  }

  score = Math.min(100, score);

  let verdict: OverlapResult["verdict"];
  if (score >= 60) verdict = "same_owner";
  else if (score >= 30) verdict = "same_provider";
  else if (score >= 10) verdict = "coincidental";
  else verdict = "unrelated";

  if (reasoning.length === 0) reasoning.push("No infrastructure overlap detected");

  return { score, verdict, reasoning };
}

// ── Main Overlap Analysis ───────────────────────────────

export async function analyzeOverlap(targets: string[]): Promise<OverlapResult> {
  if (targets.length < 2) throw new Error("Need at least 2 targets to compare");

  // Collect profiles in parallel
  const profiles = await Promise.all(targets.map(collectProfile));

  // Find overlaps
  const overlaps = findOverlaps(profiles);

  // Calculate strength
  const { score, verdict, reasoning } = calculateStrength(overlaps);

  // Build shared entities
  const sharedEntities: SharedEntity[] = overlaps.map(o => ({
    type: o.type,
    value: o.values[0],
    sharedBy: o.targets,
  }));

  return {
    targets,
    overlaps,
    sharedEntities,
    connectionStrength: score,
    verdict,
    reasoning,
    timestamp: new Date().toISOString(),
  };
}
