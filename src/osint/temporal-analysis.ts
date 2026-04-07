/**
 * Temporal Analysis — detect changes over time, domain age, certificate timeline
 * What changed, when, and is it suspicious?
 */

import { execFileNoThrow } from "../utils/execFileNoThrow.js";

export interface TemporalResult {
  target: string;
  domainAge?: DomainAge;
  certTimeline: CertEvent[];
  dnsHistory: DnsChange[];
  anomalies: TemporalAnomaly[];
  riskIndicators: string[];
  timestamp: string;
}

export interface DomainAge {
  createdDate?: string;
  ageInDays: number;
  isNew: boolean;       // < 30 days
  isYoung: boolean;     // < 180 days
}

export interface CertEvent {
  commonName: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  ageInDays: number;
  expiresInDays: number;
  isExpired: boolean;
  isExpiringSoon: boolean; // < 14 days
  isNewlyIssued: boolean;  // < 7 days
}

export interface DnsChange {
  recordType: string;
  currentValue: string;
  previousValue?: string;
  changed: boolean;
  lastChecked: string;
}

export interface TemporalAnomaly {
  type: "new_domain" | "fresh_cert" | "expiring_cert" | "expired_cert" | "dns_change" | "new_subdomain" | "suspicious_timing";
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  evidence: string;
}

// ── Domain Age Analysis ─────────────────────────────────

async function analyzeDomainAge(domain: string): Promise<DomainAge | undefined> {
  const { whoisLookup } = await import("./domain-recon.js");
  const whois = await whoisLookup(domain);

  if (!whois.createdDate) return undefined;

  const created = new Date(whois.createdDate);
  if (isNaN(created.getTime())) return undefined;

  const now = new Date();
  const ageInDays = Math.floor((now.getTime() - created.getTime()) / 86400000);

  return {
    createdDate: whois.createdDate,
    ageInDays,
    isNew: ageInDays < 30,
    isYoung: ageInDays < 180,
  };
}

// ── Certificate Timeline ────────────────────────────────

async function analyzeCertTimeline(domain: string): Promise<CertEvent[]> {
  const events: CertEvent[] = [];

  try {
    const { certTransparency } = await import("./domain-recon.js");
    const certs = await certTransparency(domain);
    const now = new Date();

    for (const cert of certs.slice(0, 20)) {
      const notBefore = new Date(cert.notBefore);
      const notAfter = new Date(cert.notAfter);

      if (isNaN(notBefore.getTime()) || isNaN(notAfter.getTime())) continue;

      const ageInDays = Math.floor((now.getTime() - notBefore.getTime()) / 86400000);
      const expiresInDays = Math.floor((notAfter.getTime() - now.getTime()) / 86400000);

      events.push({
        commonName: cert.commonName,
        issuer: cert.issuer,
        notBefore: cert.notBefore,
        notAfter: cert.notAfter,
        ageInDays,
        expiresInDays,
        isExpired: expiresInDays < 0,
        isExpiringSoon: expiresInDays >= 0 && expiresInDays < 14,
        isNewlyIssued: ageInDays < 7,
      });
    }

    // Sort by issue date (newest first)
    events.sort((a, b) => b.ageInDays - a.ageInDays);
  } catch {}

  // Also check current live certificate
  try {
    const { sslDeepAnalysis } = await import("./advanced-recon.js");
    const ssl = await sslDeepAnalysis(domain);
    if (ssl.certExpiry) {
      const expiry = new Date(ssl.certExpiry);
      const expiresInDays = Math.floor((expiry.getTime() - Date.now()) / 86400000);
      if (!events.find(e => e.expiresInDays === expiresInDays)) {
        events.unshift({
          commonName: ssl.certSubject || domain,
          issuer: ssl.certIssuer || "Unknown",
          notBefore: "current",
          notAfter: ssl.certExpiry,
          ageInDays: 0,
          expiresInDays,
          isExpired: expiresInDays < 0,
          isExpiringSoon: expiresInDays >= 0 && expiresInDays < 14,
          isNewlyIssued: false,
        });
      }
    }
  } catch {}

  return events;
}

// ── DNS Snapshot (for change detection) ─────────────────

async function takeDnsSnapshot(domain: string): Promise<Record<string, string[]>> {
  const { dnsLookup } = await import("./domain-recon.js");
  const records = await dnsLookup(domain, ["A", "AAAA", "MX", "NS", "CNAME"]);

  const snapshot: Record<string, string[]> = {};
  for (const r of records) {
    if (!snapshot[r.type]) snapshot[r.type] = [];
    snapshot[r.type].push(r.value);
  }
  return snapshot;
}

// ── Detect Anomalies ────────────────────────────────────

function detectAnomalies(
  domainAge?: DomainAge,
  certTimeline?: CertEvent[],
): TemporalAnomaly[] {
  const anomalies: TemporalAnomaly[] = [];

  // Domain age anomalies
  if (domainAge) {
    if (domainAge.isNew) {
      anomalies.push({
        type: "new_domain",
        severity: "high",
        description: `Domain registered only ${domainAge.ageInDays} days ago`,
        evidence: `Created: ${domainAge.createdDate}`,
      });
    } else if (domainAge.isYoung) {
      anomalies.push({
        type: "new_domain",
        severity: "medium",
        description: `Domain is young — registered ${domainAge.ageInDays} days ago`,
        evidence: `Created: ${domainAge.createdDate}`,
      });
    }
  }

  // Certificate anomalies
  if (certTimeline) {
    for (const cert of certTimeline) {
      if (cert.isExpired) {
        anomalies.push({
          type: "expired_cert",
          severity: "critical",
          description: `Certificate for ${cert.commonName} is EXPIRED (${Math.abs(cert.expiresInDays)} days ago)`,
          evidence: `Expired: ${cert.notAfter}`,
        });
      }
      if (cert.isExpiringSoon) {
        anomalies.push({
          type: "expiring_cert",
          severity: "high",
          description: `Certificate for ${cert.commonName} expires in ${cert.expiresInDays} days`,
          evidence: `Expires: ${cert.notAfter}`,
        });
      }
      if (cert.isNewlyIssued) {
        anomalies.push({
          type: "fresh_cert",
          severity: "medium",
          description: `Certificate for ${cert.commonName} was issued ${cert.ageInDays} days ago (newly created)`,
          evidence: `Issued: ${cert.notBefore}`,
        });
      }
    }

    // Suspicious: lots of certs in short time
    const recentCerts = certTimeline.filter(c => c.ageInDays < 30);
    if (recentCerts.length > 3) {
      anomalies.push({
        type: "suspicious_timing",
        severity: "high",
        description: `${recentCerts.length} certificates issued in the last 30 days — unusual volume`,
        evidence: recentCerts.map(c => c.commonName).join(", "),
      });
    }
  }

  return anomalies;
}

// ── Risk Indicators ─────────────────────────────────────

function buildRiskIndicators(domainAge?: DomainAge, anomalies?: TemporalAnomaly[]): string[] {
  const indicators: string[] = [];

  if (domainAge?.isNew) indicators.push("Recently registered domain (< 30 days) — common for phishing/spam");
  if (domainAge?.isYoung) indicators.push("Young domain (< 6 months) — elevated risk profile");

  if (anomalies) {
    if (anomalies.some(a => a.type === "expired_cert")) indicators.push("Expired SSL certificate — site may be abandoned or compromised");
    if (anomalies.some(a => a.type === "fresh_cert" && a.severity !== "low")) indicators.push("Recently issued certificate — could be new phishing infrastructure");
    if (anomalies.some(a => a.type === "suspicious_timing")) indicators.push("Unusual certificate issuance volume — possible automated setup");
  }

  return indicators;
}

// ── Full Temporal Analysis ──────────────────────────────

export async function analyzeTemporalProfile(domain: string): Promise<TemporalResult> {
  const clean = domain.replace(/[^a-zA-Z0-9.\-]/g, "");

  const [domainAge, certTimeline] = await Promise.all([
    analyzeDomainAge(clean),
    analyzeCertTimeline(clean),
  ]);

  const anomalies = detectAnomalies(domainAge, certTimeline);
  const riskIndicators = buildRiskIndicators(domainAge, anomalies);

  return {
    target: clean,
    domainAge,
    certTimeline,
    dnsHistory: [], // Populated when comparing with stored baseline
    anomalies,
    riskIndicators,
    timestamp: new Date().toISOString(),
  };
}
