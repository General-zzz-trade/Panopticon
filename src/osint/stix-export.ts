/**
 * STIX 2.1 Export — standardized threat intelligence output
 * Compatible with MISP, OpenCTI, TheHive, and any STIX consumer
 */

import * as crypto from "crypto";

export interface StixBundle {
  type: "bundle";
  id: string;
  spec_version: "2.1";
  created: string;
  objects: StixObject[];
}

type StixObject = StixIndicator | StixObservable | StixRelationship | StixIdentity | StixReport | StixNote;

interface StixBase {
  type: string;
  id: string;
  created: string;
  modified: string;
  spec_version: "2.1";
}

interface StixIndicator extends StixBase {
  type: "indicator";
  name: string;
  description: string;
  pattern: string;
  pattern_type: "stix";
  valid_from: string;
  indicator_types: string[];
  confidence: number;
}

interface StixObservable extends StixBase {
  type: "observed-data";
  first_observed: string;
  last_observed: string;
  number_observed: number;
  object_refs: string[];
}

interface StixRelationship extends StixBase {
  type: "relationship";
  relationship_type: string;
  source_ref: string;
  target_ref: string;
  description?: string;
}

interface StixIdentity extends StixBase {
  type: "identity";
  name: string;
  identity_class: "individual" | "group" | "organization" | "class" | "system";
  sectors?: string[];
  contact_information?: string;
}

interface StixReport extends StixBase {
  type: "report";
  name: string;
  description: string;
  published: string;
  report_types: string[];
  object_refs: string[];
}

interface StixNote extends StixBase {
  type: "note";
  content: string;
  object_refs: string[];
}

// ── Helpers ─────────────────────────────────────────────

function stixId(type: string, seed?: string): string {
  const uuid = seed
    ? crypto.createHash("md5").update(seed).digest("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5")
    : crypto.randomUUID();
  return `${type}--${uuid}`;
}

function now(): string {
  return new Date().toISOString();
}

// ── Convert Investigation Results to STIX ───────────────

export function investigationToStix(target: string, findings: Record<string, any>): StixBundle {
  const objects: StixObject[] = [];
  const ts = now();
  const objectRefs: string[] = [];

  // Create identity for Panopticon
  const panopticonId = stixId("identity", "panopticon");
  objects.push({
    type: "identity", id: panopticonId, spec_version: "2.1",
    created: ts, modified: ts,
    name: "Panopticon OSINT Platform",
    identity_class: "system",
  });

  // Domain findings → STIX indicators
  if (findings.domain) {
    const d = findings.domain;

    // Domain itself
    const domainId = stixId("indicator", `domain:${target}`);
    objects.push({
      type: "indicator", id: domainId, spec_version: "2.1",
      created: ts, modified: ts,
      name: `Domain: ${target}`,
      description: `WHOIS registrar: ${d.whois?.registrar || "unknown"}. DNS records: ${d.dns?.length || 0}. Subdomains: ${d.subdomains?.length || 0}.`,
      pattern: `[domain-name:value = '${target}']`,
      pattern_type: "stix",
      valid_from: ts,
      indicator_types: ["domain-name"],
      confidence: 90,
    });
    objectRefs.push(domainId);

    // IPs from DNS
    for (const record of (d.dns || []).filter((r: any) => r.type === "A")) {
      const ipId = stixId("indicator", `ip:${record.value}`);
      objects.push({
        type: "indicator", id: ipId, spec_version: "2.1",
        created: ts, modified: ts,
        name: `IPv4: ${record.value}`,
        description: `Resolved from ${target}`,
        pattern: `[ipv4-addr:value = '${record.value}']`,
        pattern_type: "stix",
        valid_from: ts,
        indicator_types: ["ipv4-addr"],
        confidence: 95,
      });
      objectRefs.push(ipId);

      // Relationship: domain resolves-to IP
      objects.push({
        type: "relationship", id: stixId("relationship"), spec_version: "2.1",
        created: ts, modified: ts,
        relationship_type: "resolves-to",
        source_ref: domainId,
        target_ref: ipId,
      });
    }

    // Subdomains
    for (const sub of (d.subdomains || []).slice(0, 50)) {
      const subId = stixId("indicator", `domain:${sub.subdomain}`);
      objects.push({
        type: "indicator", id: subId, spec_version: "2.1",
        created: ts, modified: ts,
        name: `Subdomain: ${sub.subdomain}`,
        description: `Discovered via ${sub.source}${sub.ip ? `, IP: ${sub.ip}` : ""}`,
        pattern: `[domain-name:value = '${sub.subdomain}']`,
        pattern_type: "stix",
        valid_from: ts,
        indicator_types: ["domain-name"],
        confidence: 80,
      });
      objectRefs.push(subId);
    }
  }

  // Threat findings → STIX indicators
  if (findings.threat) {
    for (const t of (findings.threat.threats || [])) {
      const threatId = stixId("indicator", `threat:${t.source}:${t.description?.slice(0, 30)}`);
      objects.push({
        type: "indicator", id: threatId, spec_version: "2.1",
        created: ts, modified: ts,
        name: `Threat: ${t.type} (${t.source})`,
        description: t.description,
        pattern: `[domain-name:value = '${target}']`,
        pattern_type: "stix",
        valid_from: ts,
        indicator_types: [t.type === "malware" ? "malicious-activity" : "anomalous-activity"],
        confidence: Math.round(t.confidence * 100),
      });
      objectRefs.push(threatId);
    }

    // Blacklist hits
    for (const bl of (findings.threat.blacklists || []).filter((b: any) => b.listed)) {
      const blId = stixId("indicator", `blacklist:${bl.name}`);
      objects.push({
        type: "indicator", id: blId, spec_version: "2.1",
        created: ts, modified: ts,
        name: `Blacklisted: ${bl.name}`,
        description: `Target IP listed on ${bl.name} DNSBL`,
        pattern: `[domain-name:value = '${target}']`,
        pattern_type: "stix",
        valid_from: ts,
        indicator_types: ["malicious-activity"],
        confidence: 85,
      });
      objectRefs.push(blId);
    }
  }

  // Network findings
  if (findings.network) {
    const n = findings.network;
    if (n.geo) {
      const geoNote = stixId("note");
      objects.push({
        type: "note", id: geoNote, spec_version: "2.1",
        created: ts, modified: ts,
        content: `Geolocation: ${n.geo.country} ${n.geo.city} | ISP: ${n.geo.isp} | ASN: ${n.geo.as}`,
        object_refs: objectRefs.slice(0, 1),
      });
    }
  }

  // Create report wrapping everything
  const reportId = stixId("report");
  objects.push({
    type: "report", id: reportId, spec_version: "2.1",
    created: ts, modified: ts,
    name: `OSINT Investigation: ${target}`,
    description: `Automated investigation by Panopticon. Modules used: ${Object.keys(findings).join(", ")}`,
    published: ts,
    report_types: ["threat-report"],
    object_refs: objectRefs,
  });

  return {
    type: "bundle",
    id: stixId("bundle"),
    spec_version: "2.1",
    created: ts,
    objects,
  };
}

// ── MISP Event Format ───────────────────────────────────

export interface MispEvent {
  Event: {
    info: string;
    date: string;
    threat_level_id: string;  // 1=High, 2=Medium, 3=Low, 4=Undefined
    analysis: string;         // 0=Initial, 1=Ongoing, 2=Completed
    distribution: string;
    Attribute: MispAttribute[];
    Tag: { name: string }[];
  };
}

interface MispAttribute {
  type: string;
  category: string;
  value: string;
  comment: string;
  to_ids: boolean;
}

export function investigationToMisp(target: string, findings: Record<string, any>): MispEvent {
  const attributes: MispAttribute[] = [];
  const tags: { name: string }[] = [{ name: "osint:source-type=\"automated\"" }];

  const riskLevel = findings.threat?.riskScore >= 70 ? "1" : findings.threat?.riskScore >= 30 ? "2" : "3";

  // Domain
  if (findings.domain) {
    attributes.push({ type: "domain", category: "Network activity", value: target, comment: "Investigation target", to_ids: true });

    for (const record of (findings.domain.dns || []).filter((r: any) => r.type === "A")) {
      attributes.push({ type: "ip-dst", category: "Network activity", value: record.value, comment: "Resolved IP", to_ids: true });
    }

    for (const sub of (findings.domain.subdomains || []).slice(0, 30)) {
      attributes.push({ type: "hostname", category: "Network activity", value: sub.subdomain, comment: `Subdomain (${sub.source})`, to_ids: false });
    }
  }

  // Threat
  if (findings.threat?.threats?.length > 0) {
    tags.push({ name: "tlp:amber" });
    for (const t of findings.threat.threats) {
      attributes.push({ type: "text", category: "External analysis", value: `[${t.source}] ${t.description}`, comment: t.type, to_ids: false });
    }
  }

  return {
    Event: {
      info: `Panopticon OSINT: ${target}`,
      date: new Date().toISOString().split("T")[0],
      threat_level_id: riskLevel,
      analysis: "2",
      distribution: "0",
      Attribute: attributes,
      Tag: tags,
    },
  };
}
