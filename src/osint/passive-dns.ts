/**
 * Passive DNS — historical DNS data from free sources
 * Replaces SecurityTrails without API key
 *
 * Sources: Wayback Machine DNS snapshots, DNSDB community, RapidDNS
 */

export interface PassiveDnsResult {
  domain: string;
  history: DnsHistoryEntry[];
  firstSeen?: string;
  lastSeen?: string;
  ipHistory: string[];        // All IPs this domain has resolved to
  nameserverHistory: string[];
  changes: DnsChangeEvent[];
  stats: { totalRecords: number; uniqueIps: number; sourcesQueried: number };
  timestamp: string;
}

export interface DnsHistoryEntry {
  date: string;
  type: string;
  value: string;
  source: string;
}

export interface DnsChangeEvent {
  date: string;
  type: string;
  from: string;
  to: string;
  significance: "high" | "medium" | "low";
}

// ── Source 1: Wayback Machine DNS (CDX API) ─────────────
// Query archived versions of the site to see historical DNS resolution

async function getWaybackDnsHistory(domain: string): Promise<DnsHistoryEntry[]> {
  const entries: DnsHistoryEntry[] = [];

  try {
    // Get archived snapshots spread across time
    const response = await fetch(
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&output=json&fl=timestamp&collapse=timestamp:6&limit=50`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!response.ok) return entries;

    const data: string[][] = await response.json();
    const timestamps = data.slice(1).map(row => row[0]);

    // For each timestamp period, we can infer DNS was resolving
    // The actual IP at each time requires checking the archived page headers
    for (const ts of timestamps.slice(0, 20)) {
      const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
      entries.push({
        date,
        type: "A",
        value: `[archived ${date}]`,
        source: "wayback-cdx",
      });
    }
  } catch {}

  return entries;
}

// ── Source 2: RapidDNS (free, no key) ───────────────────

async function getRapidDnsHistory(domain: string): Promise<DnsHistoryEntry[]> {
  const entries: DnsHistoryEntry[] = [];

  try {
    const response = await fetch(
      `https://rapiddns.io/subdomain/${encodeURIComponent(domain)}?full=1`,
      {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Panopticon/1.0)" },
      }
    );
    if (!response.ok) return entries;

    const html = await response.text();
    // Parse table rows
    const rows = html.matchAll(/<tr>\s*<th[^>]*>\d+<\/th>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>/gi);
    for (const row of rows) {
      const subdomain = row[1].trim();
      const ip = row[2].trim();
      const type = row[3].trim();

      if (subdomain && ip) {
        entries.push({
          date: new Date().toISOString().split("T")[0],
          type: type || "A",
          value: `${subdomain} → ${ip}`,
          source: "rapiddns",
        });
      }
    }
  } catch {}

  return entries;
}

// ── Source 3: DNSHistory.org (free) ──────────────────────

async function getDnsHistoryOrg(domain: string): Promise<DnsHistoryEntry[]> {
  const entries: DnsHistoryEntry[] = [];

  try {
    const response = await fetch(
      `https://dnshistory.org/dns-records/${encodeURIComponent(domain)}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0" },
      }
    );
    if (!response.ok) return entries;

    const html = await response.text();
    // Extract historical records
    const records = html.matchAll(/<td[^>]*>(\d{4}-\d{2}-\d{2})<\/td>\s*<td[^>]*>(\w+)<\/td>\s*<td[^>]*>([^<]+)<\/td>/gi);
    for (const r of records) {
      entries.push({
        date: r[1],
        type: r[2],
        value: r[3].trim(),
        source: "dnshistory.org",
      });
    }
  } catch {}

  return entries;
}

// ── Source 4: ViewDNS.info (free, limited) ───────────────

async function getViewDnsHistory(domain: string): Promise<DnsHistoryEntry[]> {
  const entries: DnsHistoryEntry[] = [];

  try {
    const response = await fetch(
      `https://viewdns.info/iphistory/?domain=${encodeURIComponent(domain)}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      }
    );
    if (!response.ok) return entries;

    const html = await response.text();
    // Parse IP history table
    const rows = html.matchAll(/<tr>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>/gi);
    for (const row of rows) {
      const ip = row[1].trim();
      const location = row[2].trim();
      const date = row[3].trim();

      if (ip && /\d+\.\d+\.\d+\.\d+/.test(ip)) {
        entries.push({
          date: date || new Date().toISOString().split("T")[0],
          type: "A",
          value: `${ip} (${location})`,
          source: "viewdns.info",
        });
      }
    }
  } catch {}

  return entries;
}

// ── Detect Changes Between Records ──────────────────────

function detectChanges(entries: DnsHistoryEntry[]): DnsChangeEvent[] {
  const changes: DnsChangeEvent[] = [];
  const byType = new Map<string, DnsHistoryEntry[]>();

  for (const e of entries) {
    const list = byType.get(e.type) || [];
    list.push(e);
    byType.set(e.type, list);
  }

  for (const [type, records] of byType) {
    // Sort by date
    records.sort((a, b) => a.date.localeCompare(b.date));

    for (let i = 1; i < records.length; i++) {
      if (records[i].value !== records[i - 1].value) {
        changes.push({
          date: records[i].date,
          type,
          from: records[i - 1].value,
          to: records[i].value,
          significance: type === "A" || type === "NS" ? "high" : "medium",
        });
      }
    }
  }

  return changes.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Full Passive DNS History ────────────────────────────

export async function getPassiveDnsHistory(domain: string): Promise<PassiveDnsResult> {
  const clean = domain.replace(/[^a-zA-Z0-9.\-]/g, "").toLowerCase();

  // Query all sources in parallel
  const [wayback, rapid, history, viewdns] = await Promise.all([
    getWaybackDnsHistory(clean),
    getRapidDnsHistory(clean),
    getDnsHistoryOrg(clean),
    getViewDnsHistory(clean),
  ]);

  const allEntries = [...wayback, ...rapid, ...history, ...viewdns];

  // Sort by date
  allEntries.sort((a, b) => a.date.localeCompare(b.date));

  // Extract unique IPs and nameservers
  const ips = new Set<string>();
  const nameservers = new Set<string>();
  for (const e of allEntries) {
    const ipMatch = e.value.match(/\b(\d+\.\d+\.\d+\.\d+)\b/);
    if (ipMatch) ips.add(ipMatch[1]);
    if (e.type === "NS") nameservers.add(e.value);
  }

  const changes = detectChanges(allEntries.filter(e => e.source !== "wayback-cdx"));

  return {
    domain: clean,
    history: allEntries,
    firstSeen: allEntries[0]?.date,
    lastSeen: allEntries[allEntries.length - 1]?.date,
    ipHistory: [...ips],
    nameserverHistory: [...nameservers],
    changes,
    stats: {
      totalRecords: allEntries.length,
      uniqueIps: ips.size,
      sourcesQueried: 4,
    },
    timestamp: new Date().toISOString(),
  };
}
