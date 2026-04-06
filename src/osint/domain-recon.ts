/**
 * Domain Reconnaissance — WHOIS, DNS, subdomains, certificate transparency
 * No external APIs — uses shell commands + free public web scraping
 * All shell calls use execFileNoThrow (no shell injection)
 */

import { execFileNoThrow } from "../utils/execFileNoThrow.js";

export interface WhoisResult {
  domain: string;
  registrar?: string;
  createdDate?: string;
  expiryDate?: string;
  updatedDate?: string;
  nameServers: string[];
  registrant?: string;
  registrantOrg?: string;
  registrantCountry?: string;
  dnssec?: string;
  status: string[];
  raw: string;
}

export interface DnsRecord {
  type: string;
  name: string;
  value: string;
  ttl?: number;
  priority?: number;
}

export interface SubdomainResult {
  subdomain: string;
  source: string;
  ip?: string;
}

export interface CertEntry {
  commonName: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  sans: string[];
}

function sanitizeDomain(domain: string): string {
  return domain.replace(/[^a-zA-Z0-9.\-]/g, "");
}

// ── WHOIS Lookup ────────────────────────────────────────

export async function whoisLookup(domain: string): Promise<WhoisResult> {
  const clean = sanitizeDomain(domain);
  const { stdout: raw } = await execFileNoThrow("whois", [clean], { timeoutMs: 15000 });

  const result: WhoisResult = {
    domain: clean,
    nameServers: [],
    status: [],
    raw,
  };

  for (const line of raw.split("\n")) {
    const l = line.trim();
    const kv = l.split(/:\s+/);
    if (kv.length < 2) continue;
    const key = kv[0].toLowerCase();
    const val = kv.slice(1).join(": ").trim();

    if (key.includes("registrar") && !key.includes("url") && !key.includes("abuse") && !result.registrar) {
      result.registrar = val;
    } else if (key.includes("creation") || key.includes("created")) {
      result.createdDate = val;
    } else if (key.includes("expir") || key.includes("expiry") || key.includes("paid-till")) {
      result.expiryDate = val;
    } else if (key.includes("updated") || key.includes("modified")) {
      result.updatedDate = val;
    } else if (key.includes("name server") || key.includes("nserver")) {
      result.nameServers.push(val.toLowerCase());
    } else if (key.includes("registrant name") || (key === "registrant" && val)) {
      result.registrant = val;
    } else if (key.includes("registrant org")) {
      result.registrantOrg = val;
    } else if (key.includes("registrant country")) {
      result.registrantCountry = val;
    } else if (key.includes("dnssec")) {
      result.dnssec = val;
    } else if (key.includes("status")) {
      result.status.push(val);
    }
  }

  return result;
}

// ── DNS Record Enumeration ──────────────────────────────

const DNS_RECORD_TYPES = ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA", "SRV", "CAA", "PTR"];

export async function dnsLookup(domain: string, types?: string[]): Promise<DnsRecord[]> {
  const clean = sanitizeDomain(domain);
  const recordTypes = types || DNS_RECORD_TYPES;
  const records: DnsRecord[] = [];

  for (const type of recordTypes) {
    const { stdout, status } = await execFileNoThrow("dig", ["+short", clean, type], { timeoutMs: 10000 });

    if (status !== 0 || !stdout.trim()) {
      // Fallback to nslookup
      const nslookup = await execFileNoThrow("nslookup", [`-type=${type}`, clean], { timeoutMs: 10000 });
      for (const line of nslookup.stdout.split("\n")) {
        const match = line.match(/(?:address|mail exchanger|nameserver|text)\s*[=:]\s*(.+)/i);
        if (match) {
          records.push({ type, name: clean, value: match[1].trim() });
        }
      }
      continue;
    }

    for (const line of stdout.split("\n")) {
      const val = line.trim();
      if (!val || val.startsWith(";;")) continue;

      const record: DnsRecord = { type, name: clean, value: val };

      if (type === "MX") {
        const parts = val.split(/\s+/);
        if (parts.length >= 2) {
          record.priority = parseInt(parts[0], 10);
          record.value = parts[1].replace(/\.$/, "");
        }
      }

      if (type === "SOA") {
        record.value = val.split(/\s+/).map(p => p.replace(/\.$/, "")).join(" ");
      }

      records.push(record);
    }
  }

  return records;
}

// ── Reverse DNS ─────────────────────────────────────────

export async function reverseDns(ip: string): Promise<string[]> {
  const clean = ip.replace(/[^a-fA-F0-9.:]/g, "");
  const hostnames: string[] = [];

  const { stdout } = await execFileNoThrow("dig", ["+short", "-x", clean], { timeoutMs: 10000 });
  if (stdout.trim()) {
    for (const line of stdout.split("\n")) {
      const h = line.trim().replace(/\.$/, "");
      if (h) hostnames.push(h);
    }
  }

  if (hostnames.length === 0) {
    const { stdout: hostOut } = await execFileNoThrow("host", [clean], { timeoutMs: 10000 });
    const match = hostOut.match(/pointer\s+(.+?)\.?\s*$/m);
    if (match) hostnames.push(match[1]);
  }

  return hostnames;
}

// ── Subdomain Enumeration via Certificate Transparency ──

export async function enumerateSubdomains(domain: string): Promise<SubdomainResult[]> {
  const clean = sanitizeDomain(domain);
  const subdomains: Map<string, SubdomainResult> = new Map();

  // Source 1: crt.sh (Certificate Transparency logs — free, no API key)
  try {
    const response = await fetch(`https://crt.sh/?q=%25.${clean}&output=json`, {
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) {
      const entries: any[] = await response.json();
      for (const entry of entries) {
        const names = (entry.name_value || "").split("\n");
        for (const name of names) {
          const sub = name.trim().toLowerCase().replace(/^\*\./, "");
          if (sub.endsWith(clean) && !subdomains.has(sub)) {
            subdomains.set(sub, { subdomain: sub, source: "crt.sh" });
          }
        }
      }
    }
  } catch {}

  // Source 2: DNS brute-force common prefixes
  const commonPrefixes = [
    "www", "mail", "ftp", "smtp", "pop", "imap", "blog", "webmail",
    "server", "ns1", "ns2", "dns", "dns1", "dns2", "mx", "mx1",
    "remote", "vpn", "admin", "api", "dev", "staging", "test",
    "app", "m", "mobile", "portal", "secure", "shop", "store",
    "cdn", "static", "assets", "img", "images", "media", "video",
    "docs", "wiki", "git", "gitlab", "jenkins", "ci", "monitor",
    "grafana", "kibana", "elastic", "db", "database", "mysql",
    "postgres", "redis", "mongo", "mq", "rabbit", "kafka",
    "login", "sso", "auth", "oauth", "id", "accounts",
    "status", "health", "metrics", "prometheus",
    "backup", "old", "new", "beta", "alpha", "demo",
    "cloud", "aws", "s3", "gcp", "azure",
  ];

  const batchSize = 10;
  for (let i = 0; i < commonPrefixes.length; i += batchSize) {
    const batch = commonPrefixes.slice(i, i + batchSize);
    const promises = batch.map(async (prefix) => {
      const sub = `${prefix}.${clean}`;
      if (subdomains.has(sub)) return;
      const { stdout } = await execFileNoThrow("dig", ["+short", sub, "A"], { timeoutMs: 5000 });
      const trimmed = stdout.trim();
      if (trimmed && !trimmed.includes("NXDOMAIN")) {
        const ip = trimmed.split("\n")[0].trim();
        subdomains.set(sub, { subdomain: sub, source: "dns-bruteforce", ip });
      }
    });
    await Promise.all(promises);
  }

  return Array.from(subdomains.values());
}

// ── Certificate Transparency Details ────────────────────

export async function certTransparency(domain: string): Promise<CertEntry[]> {
  const clean = sanitizeDomain(domain);
  const certs: CertEntry[] = [];

  try {
    const response = await fetch(`https://crt.sh/?q=${clean}&output=json`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return certs;

    const entries: any[] = await response.json();
    const seen = new Set<string>();

    for (const entry of entries.slice(0, 50)) {
      const key = `${entry.common_name}:${entry.serial_number}`;
      if (seen.has(key)) continue;
      seen.add(key);

      certs.push({
        commonName: entry.common_name || "",
        issuer: entry.issuer_name || "",
        notBefore: entry.not_before || "",
        notAfter: entry.not_after || "",
        sans: (entry.name_value || "").split("\n").filter(Boolean),
      });
    }
  } catch {}

  return certs;
}

// ── Zone Transfer Attempt ───────────────────────────────

export async function attemptZoneTransfer(domain: string): Promise<{ success: boolean; records: string[] }> {
  const clean = sanitizeDomain(domain);
  const records: string[] = [];

  const { stdout: nsOutput } = await execFileNoThrow("dig", ["+short", clean, "NS"], { timeoutMs: 10000 });
  const nameservers = nsOutput.split("\n").map(ns => ns.trim().replace(/\.$/, "")).filter(Boolean);

  for (const ns of nameservers) {
    const { stdout: axfr } = await execFileNoThrow("dig", [`@${ns}`, clean, "AXFR", "+short"], { timeoutMs: 15000 });
    if (axfr && !axfr.includes("Transfer failed") && !axfr.includes("REFUSED") && axfr.trim()) {
      records.push(...axfr.split("\n").filter(Boolean));
      return { success: true, records };
    }
  }

  return { success: false, records };
}

// ── Full Domain Recon ───────────────────────────────────

export interface DomainReconResult {
  domain: string;
  whois: WhoisResult;
  dns: DnsRecord[];
  subdomains: SubdomainResult[];
  certificates: CertEntry[];
  zoneTransfer: { success: boolean; records: string[] };
  reverseDnsMap: Record<string, string[]>;
  timestamp: string;
}

export async function fullDomainRecon(domain: string): Promise<DomainReconResult> {
  const [whois, dns, subdomains, certificates, zoneTransfer] = await Promise.all([
    whoisLookup(domain),
    dnsLookup(domain),
    enumerateSubdomains(domain),
    certTransparency(domain),
    attemptZoneTransfer(domain),
  ]);

  // Resolve IPs from A records for reverse DNS
  const ips = new Set(dns.filter(r => r.type === "A" || r.type === "AAAA").map(r => r.value));
  const reverseDnsMap: Record<string, string[]> = {};
  for (const ip of ips) {
    const hostnames = await reverseDns(ip);
    if (hostnames.length > 0) reverseDnsMap[ip] = hostnames;
  }

  return {
    domain,
    whois,
    dns,
    subdomains,
    certificates,
    zoneTransfer,
    reverseDnsMap,
    timestamp: new Date().toISOString(),
  };
}
