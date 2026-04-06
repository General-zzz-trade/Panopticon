/**
 * Intelligence Correlator — entity relationship mapping, cross-referencing, timeline
 * In-memory graph structure for correlating OSINT findings
 */

export type EntityType =
  | "domain" | "ip" | "email" | "username" | "organization"
  | "person" | "url" | "technology" | "certificate" | "port"
  | "nameserver" | "registrar" | "hosting" | "country" | "asn";

export type RelationType =
  | "resolves_to" | "hosts" | "owns" | "registered_by" | "uses_technology"
  | "has_subdomain" | "has_certificate" | "associated_with" | "found_on"
  | "mx_record" | "ns_record" | "same_person" | "works_at" | "located_in"
  | "open_port" | "served_by" | "protected_by" | "linked_from";

export interface Entity {
  id: string;
  type: EntityType;
  value: string;
  metadata: Record<string, any>;
  sources: string[];
  firstSeen: string;
  lastSeen: string;
  confidence: number;  // 0.0 – 1.0
}

export interface Relation {
  id: string;
  sourceId: string;
  targetId: string;
  type: RelationType;
  metadata: Record<string, any>;
  confidence: number;
  source: string;
  timestamp: string;
}

export interface TimelineEvent {
  timestamp: string;
  entityId: string;
  eventType: string;
  description: string;
  source: string;
}

export interface CorrelationGraph {
  entities: Map<string, Entity>;
  relations: Relation[];
  timeline: TimelineEvent[];
}

// ── Graph Builder ───────────────────────────────────────

export class IntelGraph {
  private entities = new Map<string, Entity>();
  private relations: Relation[] = [];
  private timeline: TimelineEvent[] = [];
  private nextId = 1;

  private genId(): string {
    return `e${this.nextId++}`;
  }

  // ── Entity Management ───────────────────────────────

  addEntity(type: EntityType, value: string, metadata: Record<string, any> = {}, source = "osint"): Entity {
    const key = `${type}:${value.toLowerCase()}`;
    const existing = this.entities.get(key);

    if (existing) {
      existing.lastSeen = new Date().toISOString();
      existing.metadata = { ...existing.metadata, ...metadata };
      if (!existing.sources.includes(source)) existing.sources.push(source);
      existing.confidence = Math.min(1, existing.confidence + 0.1);
      return existing;
    }

    const entity: Entity = {
      id: this.genId(),
      type,
      value,
      metadata,
      sources: [source],
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      confidence: 0.5,
    };

    this.entities.set(key, entity);
    return entity;
  }

  getEntity(type: EntityType, value: string): Entity | undefined {
    return this.entities.get(`${type}:${value.toLowerCase()}`);
  }

  findEntities(filter: { type?: EntityType; minConfidence?: number }): Entity[] {
    let result = Array.from(this.entities.values());
    if (filter.type) result = result.filter(e => e.type === filter.type);
    if (filter.minConfidence !== undefined) result = result.filter(e => e.confidence >= filter.minConfidence!);
    return result;
  }

  // ── Relation Management ─────────────────────────────

  addRelation(
    source: Entity,
    target: Entity,
    type: RelationType,
    metadata: Record<string, any> = {},
    relSource = "osint"
  ): Relation {
    // Avoid duplicates
    const existing = this.relations.find(
      r => r.sourceId === source.id && r.targetId === target.id && r.type === type
    );
    if (existing) {
      existing.confidence = Math.min(1, existing.confidence + 0.1);
      return existing;
    }

    const relation: Relation = {
      id: `r${this.relations.length + 1}`,
      sourceId: source.id,
      targetId: target.id,
      type,
      metadata,
      confidence: 0.5,
      source: relSource,
      timestamp: new Date().toISOString(),
    };

    this.relations.push(relation);
    return relation;
  }

  getRelations(entityId: string): Relation[] {
    return this.relations.filter(r => r.sourceId === entityId || r.targetId === entityId);
  }

  // ── Timeline ────────────────────────────────────────

  addTimelineEvent(entityId: string, eventType: string, description: string, source = "osint", timestamp?: string) {
    this.timeline.push({
      timestamp: timestamp || new Date().toISOString(),
      entityId,
      eventType,
      description,
      source,
    });
    this.timeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // ── Analysis ────────────────────────────────────────

  /** Find entities connected to the given entity within N hops */
  findConnected(entityId: string, maxHops = 2): Set<string> {
    const visited = new Set<string>();
    const queue: { id: string; depth: number }[] = [{ id: entityId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > maxHops) continue;
      visited.add(id);

      for (const rel of this.relations) {
        if (rel.sourceId === id && !visited.has(rel.targetId)) {
          queue.push({ id: rel.targetId, depth: depth + 1 });
        }
        if (rel.targetId === id && !visited.has(rel.sourceId)) {
          queue.push({ id: rel.sourceId, depth: depth + 1 });
        }
      }
    }

    return visited;
  }

  /** Find the shortest path between two entities */
  findPath(fromId: string, toId: string): string[] | null {
    const visited = new Set<string>();
    const queue: { id: string; path: string[] }[] = [{ id: fromId, path: [fromId] }];

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;
      if (id === toId) return path;
      if (visited.has(id)) continue;
      visited.add(id);

      for (const rel of this.relations) {
        const next = rel.sourceId === id ? rel.targetId : rel.targetId === id ? rel.sourceId : null;
        if (next && !visited.has(next)) {
          queue.push({ id: next, path: [...path, next] });
        }
      }
    }

    return null;
  }

  /** Get centrality score (number of connections) */
  getCentrality(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const entity of this.entities.values()) {
      counts.set(entity.id, 0);
    }
    for (const rel of this.relations) {
      counts.set(rel.sourceId, (counts.get(rel.sourceId) || 0) + 1);
      counts.set(rel.targetId, (counts.get(rel.targetId) || 0) + 1);
    }
    return counts;
  }

  /** Find clusters (connected components) */
  findClusters(): Entity[][] {
    const visited = new Set<string>();
    const clusters: Entity[][] = [];

    for (const entity of this.entities.values()) {
      if (visited.has(entity.id)) continue;

      const connected = this.findConnected(entity.id, 100);
      const cluster: Entity[] = [];
      for (const id of connected) {
        visited.add(id);
        const e = Array.from(this.entities.values()).find(en => en.id === id);
        if (e) cluster.push(e);
      }
      if (cluster.length > 0) clusters.push(cluster);
    }

    return clusters.sort((a, b) => b.length - a.length);
  }

  // ── Populate from OSINT Results ─────────────────────

  ingestDomainRecon(data: any): void {
    const domainEntity = this.addEntity("domain", data.domain, {}, "domain-recon");

    // WHOIS
    if (data.whois) {
      if (data.whois.registrar) {
        const reg = this.addEntity("registrar", data.whois.registrar, {}, "whois");
        this.addRelation(domainEntity, reg, "registered_by", {}, "whois");
      }
      if (data.whois.registrantOrg) {
        const org = this.addEntity("organization", data.whois.registrantOrg, {}, "whois");
        this.addRelation(domainEntity, org, "owns", {}, "whois");
      }
      if (data.whois.registrantCountry) {
        const country = this.addEntity("country", data.whois.registrantCountry, {}, "whois");
        this.addRelation(domainEntity, country, "located_in", {}, "whois");
      }
      for (const ns of data.whois.nameServers || []) {
        const nsEntity = this.addEntity("nameserver", ns, {}, "whois");
        this.addRelation(domainEntity, nsEntity, "ns_record", {}, "whois");
      }

      if (data.whois.createdDate) {
        this.addTimelineEvent(domainEntity.id, "domain_created", `Domain ${data.domain} registered`, "whois", data.whois.createdDate);
      }
    }

    // DNS records
    for (const record of data.dns || []) {
      if (record.type === "A" || record.type === "AAAA") {
        const ip = this.addEntity("ip", record.value, { type: record.type }, "dns");
        this.addRelation(domainEntity, ip, "resolves_to", {}, "dns");
      } else if (record.type === "MX") {
        const mx = this.addEntity("domain", record.value, { type: "mx" }, "dns");
        this.addRelation(domainEntity, mx, "mx_record", { priority: record.priority }, "dns");
      } else if (record.type === "NS") {
        const ns = this.addEntity("nameserver", record.value, {}, "dns");
        this.addRelation(domainEntity, ns, "ns_record", {}, "dns");
      }
    }

    // Subdomains
    for (const sub of data.subdomains || []) {
      const subEntity = this.addEntity("domain", sub.subdomain, { source: sub.source }, sub.source);
      this.addRelation(domainEntity, subEntity, "has_subdomain", {}, sub.source);
      if (sub.ip) {
        const ip = this.addEntity("ip", sub.ip, {}, sub.source);
        this.addRelation(subEntity, ip, "resolves_to", {}, sub.source);
      }
    }

    // Certificates
    for (const cert of data.certificates || []) {
      const certEntity = this.addEntity("certificate", cert.commonName, {
        issuer: cert.issuer,
        notBefore: cert.notBefore,
        notAfter: cert.notAfter,
      }, "crt.sh");
      this.addRelation(domainEntity, certEntity, "has_certificate", {}, "crt.sh");
    }
  }

  ingestNetworkRecon(data: any): void {
    const target = this.addEntity(
      data.resolvedIp ? "ip" : "domain",
      data.resolvedIp || data.target,
      {},
      "network-recon"
    );

    if (data.geo) {
      if (data.geo.country) {
        const country = this.addEntity("country", data.geo.country, {
          code: data.geo.countryCode,
          city: data.geo.city,
          region: data.geo.region,
        }, "geoip");
        this.addRelation(target, country, "located_in", {
          lat: data.geo.lat, lon: data.geo.lon,
        }, "geoip");
      }
      if (data.geo.org) {
        const org = this.addEntity("organization", data.geo.org, { isp: data.geo.isp, as: data.geo.as }, "geoip");
        this.addRelation(target, org, "hosts", {}, "geoip");
      }
    }

    for (const port of data.openPorts || []) {
      const portEntity = this.addEntity("port", `${data.target}:${port.port}`, {
        service: port.service, banner: port.banner,
      }, "portscan");
      this.addRelation(target, portEntity, "open_port", {}, "portscan");
    }

    if (data.httpHeaders?.server) {
      const tech = this.addEntity("technology", data.httpHeaders.server, { type: "server" }, "http-headers");
      this.addRelation(target, tech, "served_by", {}, "http-headers");
    }
  }

  ingestIdentityRecon(data: any): void {
    const queryEntity = data.queryType === "email"
      ? this.addEntity("email", data.query, {}, "identity-recon")
      : this.addEntity("username", data.query, {}, "identity-recon");

    for (const profile of data.foundProfiles || []) {
      const urlEntity = this.addEntity("url", profile.url, {
        platform: profile.platform,
      }, "username-enum");
      this.addRelation(queryEntity, urlEntity, "found_on", { platform: profile.platform }, "username-enum");
    }

    if (data.emailValidation?.domain) {
      const domain = this.addEntity("domain", data.emailValidation.domain, {}, "email-validation");
      this.addRelation(queryEntity, domain, "associated_with", {}, "email-validation");
    }
  }

  ingestWebIntel(data: any): void {
    const urlEntity = this.addEntity("url", data.target, {}, "web-intel");

    if (data.techStack) {
      for (const tech of [...(data.techStack.javascript || []), ...(data.techStack.css || []), ...(data.techStack.analytics || [])]) {
        const techEntity = this.addEntity("technology", tech, {}, "tech-detect");
        this.addRelation(urlEntity, techEntity, "uses_technology", {}, "tech-detect");
      }
      if (data.techStack.cms) {
        const cms = this.addEntity("technology", data.techStack.cms, { type: "cms" }, "tech-detect");
        this.addRelation(urlEntity, cms, "uses_technology", {}, "tech-detect");
      }
      if (data.techStack.cdn) {
        const cdn = this.addEntity("technology", data.techStack.cdn, { type: "cdn" }, "tech-detect");
        this.addRelation(urlEntity, cdn, "protected_by", {}, "tech-detect");
      }
      if (data.techStack.hosting) {
        const host = this.addEntity("hosting", data.techStack.hosting, {}, "tech-detect");
        this.addRelation(urlEntity, host, "hosts", {}, "tech-detect");
      }
    }
  }

  // ── Export ──────────────────────────────────────────

  export(): CorrelationGraph {
    return {
      entities: new Map(this.entities),
      relations: [...this.relations],
      timeline: [...this.timeline],
    };
  }

  toJSON(): object {
    return {
      entities: Array.from(this.entities.values()),
      relations: this.relations,
      timeline: this.timeline,
      stats: {
        entityCount: this.entities.size,
        relationCount: this.relations.length,
        timelineEvents: this.timeline.length,
        clusters: this.findClusters().length,
      },
    };
  }
}
