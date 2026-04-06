/**
 * OSINT Monitor — periodic target monitoring with change detection
 * Stores baseline, detects changes in subdomains, ports, tech stack, etc.
 */

export interface MonitorTarget {
  id: string;
  target: string;
  type: "domain" | "ip" | "url";
  checks: MonitorCheck[];
  intervalMs: number;
  lastRun?: string;
  baseline?: Record<string, any>;
  alerts: MonitorAlert[];
  enabled: boolean;
  createdAt: string;
}

export type MonitorCheck =
  | "subdomains" | "ports" | "dns" | "tech_stack" | "ssl_expiry"
  | "whois_change" | "content_change" | "new_threats" | "uptime";

export interface MonitorAlert {
  timestamp: string;
  check: MonitorCheck;
  severity: "info" | "warning" | "critical";
  message: string;
  oldValue?: string;
  newValue?: string;
}

export interface MonitorResult {
  targetId: string;
  target: string;
  alerts: MonitorAlert[];
  checksRun: number;
  timestamp: string;
  durationMs: number;
}

// ── In-memory store (for persistence, use SQLite layer) ──

const targets = new Map<string, MonitorTarget>();

export function addMonitorTarget(
  target: string,
  type: "domain" | "ip" | "url",
  checks: MonitorCheck[],
  intervalMs = 3600000
): MonitorTarget {
  const id = `mon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const entry: MonitorTarget = {
    id,
    target,
    type,
    checks,
    intervalMs,
    alerts: [],
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  targets.set(id, entry);
  return entry;
}

export function listMonitorTargets(): MonitorTarget[] {
  return Array.from(targets.values());
}

export function removeMonitorTarget(id: string): boolean {
  return targets.delete(id);
}

// ── Run Monitor Check ───────────────────────────────────

export async function runMonitorCheck(id: string): Promise<MonitorResult> {
  const entry = targets.get(id);
  if (!entry) throw new Error(`Monitor target ${id} not found`);

  const start = Date.now();
  const alerts: MonitorAlert[] = [];
  const baseline = entry.baseline || {};

  for (const check of entry.checks) {
    try {
      const newAlerts = await runSingleCheck(entry.target, check, baseline);
      alerts.push(...newAlerts);
    } catch {}
  }

  // Update baseline with current state
  entry.baseline = await buildBaseline(entry.target, entry.checks);
  entry.lastRun = new Date().toISOString();
  entry.alerts.push(...alerts);

  // Keep only last 100 alerts
  if (entry.alerts.length > 100) entry.alerts = entry.alerts.slice(-100);

  return {
    targetId: id,
    target: entry.target,
    alerts,
    checksRun: entry.checks.length,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
}

async function buildBaseline(target: string, checks: MonitorCheck[]): Promise<Record<string, any>> {
  const baseline: Record<string, any> = {};

  for (const check of checks) {
    try {
      if (check === "subdomains") {
        const { enumerateSubdomains } = await import("./domain-recon.js");
        const subs = await enumerateSubdomains(target);
        baseline.subdomains = subs.map(s => s.subdomain).sort();
      }
      if (check === "ports") {
        const { portScan } = await import("./network-recon.js");
        const ports = await portScan(target);
        baseline.openPorts = ports.filter(p => p.state === "open").map(p => p.port).sort();
      }
      if (check === "dns") {
        const { dnsLookup } = await import("./domain-recon.js");
        const dns = await dnsLookup(target, ["A", "MX", "NS"]);
        baseline.dns = dns.map(r => `${r.type}:${r.value}`).sort();
      }
      if (check === "tech_stack") {
        const { detectTechStack } = await import("./web-intel.js");
        const url = target.startsWith("http") ? target : `https://${target}`;
        const tech = await detectTechStack(url);
        baseline.techStack = [...tech.javascript, ...tech.css, tech.cms, tech.cdn].filter(Boolean).sort();
      }
      if (check === "ssl_expiry") {
        const { sslDeepAnalysis } = await import("./advanced-recon.js");
        const ssl = await sslDeepAnalysis(target);
        baseline.sslExpiry = ssl.certExpiry;
      }
    } catch {}
  }

  return baseline;
}

async function runSingleCheck(target: string, check: MonitorCheck, baseline: Record<string, any>): Promise<MonitorAlert[]> {
  const alerts: MonitorAlert[] = [];
  const now = new Date().toISOString();

  if (check === "subdomains" && baseline.subdomains) {
    const { enumerateSubdomains } = await import("./domain-recon.js");
    const current = (await enumerateSubdomains(target)).map(s => s.subdomain).sort();
    const newSubs = current.filter(s => !baseline.subdomains.includes(s));
    const removedSubs = baseline.subdomains.filter((s: string) => !current.includes(s));

    if (newSubs.length > 0) {
      alerts.push({ timestamp: now, check, severity: "warning", message: `${newSubs.length} new subdomains: ${newSubs.slice(0, 5).join(", ")}`, newValue: newSubs.join(", ") });
    }
    if (removedSubs.length > 0) {
      alerts.push({ timestamp: now, check, severity: "info", message: `${removedSubs.length} subdomains removed`, oldValue: removedSubs.join(", ") });
    }
  }

  if (check === "ports" && baseline.openPorts) {
    const { portScan } = await import("./network-recon.js");
    const current = (await portScan(target)).filter(p => p.state === "open").map(p => p.port).sort();
    const newPorts = current.filter(p => !baseline.openPorts.includes(p));
    const closedPorts = baseline.openPorts.filter((p: number) => !current.includes(p));

    if (newPorts.length > 0) {
      alerts.push({ timestamp: now, check, severity: "critical", message: `New open ports detected: ${newPorts.join(", ")}`, newValue: newPorts.join(", ") });
    }
    if (closedPorts.length > 0) {
      alerts.push({ timestamp: now, check, severity: "info", message: `Ports closed: ${closedPorts.join(", ")}`, oldValue: closedPorts.join(", ") });
    }
  }

  if (check === "ssl_expiry" && baseline.sslExpiry) {
    const expiry = new Date(baseline.sslExpiry);
    const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86400000);
    if (daysLeft < 0) {
      alerts.push({ timestamp: now, check, severity: "critical", message: `SSL certificate EXPIRED ${Math.abs(daysLeft)} days ago` });
    } else if (daysLeft < 14) {
      alerts.push({ timestamp: now, check, severity: "warning", message: `SSL certificate expires in ${daysLeft} days` });
    }
  }

  if (check === "uptime") {
    const url = target.startsWith("http") ? target : `https://${target}`;
    try {
      const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        alerts.push({ timestamp: now, check, severity: "critical", message: `Site returned ${response.status}`, newValue: String(response.status) });
      }
    } catch {
      alerts.push({ timestamp: now, check, severity: "critical", message: "Site unreachable" });
    }
  }

  return alerts;
}

// ── Batch Operations ────────────────────────────────────

export async function runAllMonitors(): Promise<MonitorResult[]> {
  const results: MonitorResult[] = [];
  for (const [id, entry] of targets) {
    if (!entry.enabled) continue;
    const result = await runMonitorCheck(id);
    results.push(result);
  }
  return results;
}
