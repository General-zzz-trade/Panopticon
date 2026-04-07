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

// ── Simple result cache (TTL-based) ─────────────────────

const _cache = new Map<string, { data: any; expiry: number }>();
function cacheGet<T>(key: string): T | null {
  const entry = _cache.get(key);
  if (!entry || Date.now() > entry.expiry) { _cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key: string, data: any, ttlMs = 300000) {
  _cache.set(key, { data, expiry: Date.now() + ttlMs });
  // Evict old entries if cache grows too large
  if (_cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of _cache) { if (now > v.expiry) _cache.delete(k); }
  }
}

// ── Fetch with retry ────────────────────────────────────

async function fetchWithRetry(url: string, options: { timeoutMs?: number; retries?: number } = {}): Promise<Response | null> {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 15000;
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return response;
    } catch {}
    if (i < retries) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
  return null;
}

// ── Subdomain Enumeration via Certificate Transparency ──

export async function enumerateSubdomains(domain: string): Promise<SubdomainResult[]> {
  const clean = sanitizeDomain(domain);

  // Check cache first
  const cached = cacheGet<SubdomainResult[]>(`subs:${clean}`);
  if (cached) return cached;

  const subdomains: Map<string, SubdomainResult> = new Map();

  // Source 1: crt.sh (with retry — often slow/flaky)
  try {
    const response = await fetchWithRetry(`https://crt.sh/?q=%25.${clean}&output=json`, { timeoutMs: 25000, retries: 2 });
    if (response) {
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

  // Source 2: CertSpotter (backup CT source — free, no key)
  if (subdomains.size < 5) {
    try {
      const response = await fetchWithRetry(`https://api.certspotter.com/v1/issuances?domain=${clean}&include_subdomains=true&expand=dns_names`, { timeoutMs: 15000 });
      if (response) {
        const entries: any[] = await response.json();
        for (const entry of entries) {
          for (const name of (entry.dns_names || [])) {
            const sub = name.trim().toLowerCase().replace(/^\*\./, "");
            if (sub.endsWith(clean) && !subdomains.has(sub)) {
              subdomains.set(sub, { subdomain: sub, source: "certspotter" });
            }
          }
        }
      }
    } catch {}
  }

  // Source 3: HackerTarget subdomain finder (free, 100/day)
  if (subdomains.size < 10) {
    try {
      const response = await fetchWithRetry(`https://api.hackertarget.com/hostsearch/?q=${clean}`, { timeoutMs: 10000 });
      if (response) {
        const text = await response.text();
        if (!text.includes("error") && !text.includes("API count")) {
          for (const line of text.split("\n")) {
            const [sub, ip] = line.split(",").map(s => s.trim());
            if (sub && sub.endsWith(clean) && !subdomains.has(sub)) {
              subdomains.set(sub, { subdomain: sub, source: "hackertarget", ip });
            }
          }
        }
      }
    } catch {}
  }

  // Source 4: DNS brute-force (expanded wordlist)
  const commonPrefixes = [
    // Core infrastructure
    "www","www2","www3","mail","mail2","ftp","smtp","pop","pop3","imap","webmail","exchange",
    "server","server1","server2","host","node","node1","node2",
    // DNS/NS
    "ns","ns1","ns2","ns3","ns4","dns","dns1","dns2","mx","mx1","mx2",
    // Remote access
    "remote","vpn","vpn1","vpn2","gateway","gw","proxy","sslvpn","citrix","rdp","ssh",
    // Admin/Management
    "admin","administrator","panel","cpanel","whm","plesk","webmin","dashboard","manage","console",
    // Auth
    "login","sso","auth","oauth","id","account","accounts","my","self-service","signup","register",
    // Development
    "dev","develop","development","staging","stage","stg","test","testing","qa","uat",
    "sandbox","preview","demo","beta","alpha","canary","nightly","rc","release","preprod","pre-prod",
    // CI/CD
    "git","gitlab","github","bitbucket","svn","repo","ci","cd","jenkins","drone","travis","build",
    "deploy","pipeline","artifact","registry","npm","docker","container","k8s","kubernetes","helm",
    // APIs
    "api","api2","api3","rest","graphql","grpc","ws","websocket","socket","rpc",
    // Apps
    "app","app2","apps","web","portal","m","mobile","ios","android",
    // Storage/CDN
    "cdn","cdn1","cdn2","static","assets","media","img","images","photo","photos","video","files",
    "upload","uploads","storage","s3","blob","backup","backups","archive","cache",
    // Database
    "db","db1","db2","database","sql","mysql","postgres","postgresql","pgsql","mongo","mongodb",
    "redis","memcache","memcached","elastic","elasticsearch","kibana","grafana","prometheus",
    "influx","clickhouse","cassandra","couchdb","neo4j",
    // Messaging
    "mq","rabbit","rabbitmq","kafka","activemq","nats","zeromq",
    // Communication
    "chat","im","slack","teams","meet","zoom","jitsi","matrix","xmpp",
    "forum","community","board","discuss","discourse","comments","feedback",
    "blog","news","press","newsletter","subscribe",
    "support","help","helpdesk","ticket","tickets","jira","zendesk","freshdesk",
    // Commerce
    "shop","store","ecommerce","cart","checkout","payment","pay","billing","invoice",
    "order","orders","catalog","product","products",
    // Internal
    "intranet","internal","corp","corporate","office","erp","crm","hr","legal","finance",
    "wiki","docs","documentation","confluence","notion","sharepoint",
    // Analytics/Monitoring
    "analytics","stats","statistics","metrics","monitor","monitoring","status","health","healthcheck",
    "log","logs","logging","sentry","newrelic","datadog","apm","trace","track","tracking",
    // Security
    "secure","security","waf","firewall","ids","ips","scan","scanner","vault",
    "cert","certs","pki","ca","ocsp","crl",
    // Email
    "email","smtp2","pop3","imap2","mailin","mailout","relay","postfix","mx3",
    // Geographic
    "us","eu","uk","cn","jp","de","fr","sg","au","br","in","kr","hk","tw",
    "east","west","north","south","central","asia","europe","americas",
    "us-east","us-west","eu-west","ap-southeast",
    // Cloud
    "cloud","aws","gcp","azure","digitalocean","linode","vultr","heroku","vercel","netlify",
    "lambda","function","functions","edge","worker","workers",
    // Versioned
    "old","new","v1","v2","v3","next","legacy","deprecated",
    "temp","tmp","scratch","playground","lab","labs","research","experiment",
  ];

  const batchSize = 15;
  for (let i = 0; i < commonPrefixes.length; i += batchSize) {
    const batch = commonPrefixes.slice(i, i + batchSize);
    const promises = batch.map(async (prefix) => {
      const sub = `${prefix}.${clean}`;
      if (subdomains.has(sub)) return;
      const { stdout } = await execFileNoThrow("dig", ["+short", sub, "A"], { timeoutMs: 3000 });
      const trimmed = stdout.trim();
      if (trimmed && !trimmed.includes("NXDOMAIN") && /^\d+\.\d+\.\d+\.\d+/.test(trimmed)) {
        const ip = trimmed.split("\n")[0].trim();
        subdomains.set(sub, { subdomain: sub, source: "dns-bruteforce", ip });
      }
    });
    await Promise.all(promises);
  }

  const result = Array.from(subdomains.values());
  cacheSet(`subs:${clean}`, result, 600000); // Cache 10 minutes
  return result;
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
    const { stdout: axfr, status } = await execFileNoThrow("dig", [`@${ns}`, clean, "AXFR", "+short"], { timeoutMs: 15000 });
    if (!axfr || !axfr.trim()) continue;

    // Filter out error/failure lines
    const lines = axfr.split("\n").filter(line => {
      const l = line.trim();
      return l && !l.startsWith(";") && !l.includes("Transfer failed") &&
        !l.includes("REFUSED") && !l.includes("communications error") &&
        !l.includes("connection reset") && !l.includes("timed out") &&
        !l.includes("no servers could be reached");
    });

    if (lines.length > 0) {
      records.push(...lines);
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
