/**
 * Passive Monitoring — continuous streams of CT logs, BGP changes, DNS updates
 * Real-time awareness without active scanning
 */

export interface PassiveAlert {
  source: string;
  type: "new_cert" | "bgp_change" | "dns_change" | "new_subdomain";
  severity: "critical" | "high" | "medium" | "info";
  target: string;
  description: string;
  data: any;
  timestamp: string;
}

export interface PassiveMonitorConfig {
  domains: string[];
  checkIntervalMs: number;
  onAlert: (alert: PassiveAlert) => void;
}

// ── CT Log Monitor (Certificate Transparency) ───────────
// Polls crt.sh for new certificates — detects new subdomains, cert changes

export async function checkNewCertificates(domain: string, since?: string): Promise<PassiveAlert[]> {
  const alerts: PassiveAlert[] = [];
  const clean = domain.replace(/[^a-zA-Z0-9.\-]/g, "");

  try {
    // Query crt.sh for recent certificates
    let url = `https://crt.sh/?q=%25.${clean}&output=json`;
    if (since) url += `&exclude=expired`;

    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) return alerts;

    const entries: any[] = await response.json();
    const now = Date.now();
    const sinceDate = since ? new Date(since).getTime() : now - 86400000; // Default: last 24h

    for (const entry of entries) {
      const entryDate = new Date(entry.entry_timestamp || entry.not_before).getTime();
      if (entryDate < sinceDate) continue;

      const names = (entry.name_value || "").split("\n").filter(Boolean);
      for (const name of names) {
        const sub = name.trim().toLowerCase().replace(/^\*\./, "");
        if (sub.endsWith(clean)) {
          alerts.push({
            source: "ct-log",
            type: "new_cert",
            severity: "info",
            target: sub,
            description: `New certificate issued for ${sub} by ${entry.issuer_name || "unknown"}`,
            data: { commonName: entry.common_name, issuer: entry.issuer_name, notBefore: entry.not_before, notAfter: entry.not_after },
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // Detect new subdomains (not seen before)
    const uniqueSubs = [...new Set(alerts.map(a => a.target))];
    if (uniqueSubs.length > 5) {
      alerts.unshift({
        source: "ct-log",
        type: "new_subdomain",
        severity: "medium",
        target: clean,
        description: `${uniqueSubs.length} new subdomains detected via CT logs in the monitoring period`,
        data: { subdomains: uniqueSubs.slice(0, 20) },
        timestamp: new Date().toISOString(),
      });
    }
  } catch {}

  return alerts;
}

// ── BGP/Routing Change Monitor ──────────────────────────
// Checks RIPE RIS for routing changes affecting target ASN/IP

export async function checkBgpChanges(target: string): Promise<PassiveAlert[]> {
  const alerts: PassiveAlert[] = [];

  try {
    // Get ASN for target
    const { asnLookup } = await import("./reverse-ip.js");
    const asn = await asnLookup(target);
    if (!asn.asn) return alerts;

    const asnNumber = asn.asn.replace("AS", "");

    // Query RIPE STAT for routing status
    const response = await fetch(
      `https://stat.ripe.net/data/routing-status/data.json?resource=AS${asnNumber}`,
      { signal: AbortSignal.timeout(15000) }
    );

    if (response.ok) {
      const data = await response.json();
      const status = data.data;

      if (status) {
        // Check for route visibility changes
        const visibility = status.visibility?.v4?.total_peers || 0;
        if (visibility < 100) {
          alerts.push({
            source: "bgp-monitor",
            type: "bgp_change",
            severity: "high",
            target: asn.asn,
            description: `Low BGP visibility for ${asn.asn}: only ${visibility} peers see this route (possible hijack or outage)`,
            data: { asn: asn.asn, visibility, name: asn.name },
            timestamp: new Date().toISOString(),
          });
        }

        // Check announced vs expected prefixes
        const announced = status.announced_space?.v4?.prefixes || 0;
        if (announced === 0) {
          alerts.push({
            source: "bgp-monitor",
            type: "bgp_change",
            severity: "critical",
            target: asn.asn,
            description: `${asn.asn} (${asn.name}) is announcing 0 IPv4 prefixes — possible BGP withdrawal`,
            data: { asn: asn.asn, announced },
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  } catch {}

  return alerts;
}

// ── DNS Change Detection ────────────────────────────────
// Compares current DNS with stored baseline

export interface DnsBaseline {
  domain: string;
  records: Record<string, string[]>;
  capturedAt: string;
}

export async function captureDnsBaseline(domain: string): Promise<DnsBaseline> {
  const { dnsLookup } = await import("./domain-recon.js");
  const records = await dnsLookup(domain, ["A", "AAAA", "MX", "NS", "CNAME"]);

  const grouped: Record<string, string[]> = {};
  for (const r of records) {
    if (!grouped[r.type]) grouped[r.type] = [];
    grouped[r.type].push(r.value);
  }

  return { domain, records: grouped, capturedAt: new Date().toISOString() };
}

export async function detectDnsChanges(domain: string, baseline: DnsBaseline): Promise<PassiveAlert[]> {
  const alerts: PassiveAlert[] = [];
  const current = await captureDnsBaseline(domain);

  for (const [type, currentValues] of Object.entries(current.records)) {
    const baselineValues = baseline.records[type] || [];
    const currentSet = new Set(currentValues);
    const baselineSet = new Set(baselineValues);

    // New records
    const added = currentValues.filter(v => !baselineSet.has(v));
    const removed = baselineValues.filter(v => !currentSet.has(v));

    if (added.length > 0) {
      alerts.push({
        source: "dns-monitor",
        type: "dns_change",
        severity: type === "A" || type === "NS" ? "high" : "medium",
        target: domain,
        description: `New ${type} record(s): ${added.join(", ")}`,
        data: { recordType: type, added, removed, current: currentValues },
        timestamp: new Date().toISOString(),
      });
    }

    if (removed.length > 0) {
      alerts.push({
        source: "dns-monitor",
        type: "dns_change",
        severity: type === "NS" ? "critical" : "medium",
        target: domain,
        description: `Removed ${type} record(s): ${removed.join(", ")}`,
        data: { recordType: type, added, removed, current: currentValues },
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Check for types that completely disappeared
  for (const type of Object.keys(baseline.records)) {
    if (!current.records[type] || current.records[type].length === 0) {
      alerts.push({
        source: "dns-monitor",
        type: "dns_change",
        severity: "high",
        target: domain,
        description: `All ${type} records removed — was: ${baseline.records[type].join(", ")}`,
        data: { recordType: type, removed: baseline.records[type] },
        timestamp: new Date().toISOString(),
      });
    }
  }

  return alerts;
}

// ── Combined Passive Check ──────────────────────────────

export async function runPassiveCheck(domain: string, options: { baseline?: DnsBaseline; since?: string } = {}): Promise<{
  alerts: PassiveAlert[];
  newBaseline: DnsBaseline;
  stats: { certAlerts: number; bgpAlerts: number; dnsAlerts: number };
}> {
  const [certAlerts, bgpAlerts, dnsBaseline] = await Promise.all([
    checkNewCertificates(domain, options.since),
    checkBgpChanges(domain),
    captureDnsBaseline(domain),
  ]);

  let dnsAlerts: PassiveAlert[] = [];
  if (options.baseline) {
    dnsAlerts = await detectDnsChanges(domain, options.baseline);
  }

  const allAlerts = [...certAlerts, ...bgpAlerts, ...dnsAlerts]
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, info: 3 };
      return (order[a.severity] || 4) - (order[b.severity] || 4);
    });

  return {
    alerts: allAlerts,
    newBaseline: dnsBaseline,
    stats: {
      certAlerts: certAlerts.length,
      bgpAlerts: bgpAlerts.length,
      dnsAlerts: dnsAlerts.length,
    },
  };
}
