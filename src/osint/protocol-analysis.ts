/**
 * Protocol-Level Analysis — SSH fingerprints, SPF/DKIM/DMARC, SMTP banners
 * Deep protocol data that web search cannot see
 */

import { execFileNoThrow } from "../utils/execFileNoThrow.js";
import * as net from "net";

// ── SSH Fingerprint Collection ──────────────────────────

export interface SshFingerprint {
  host: string;
  port: number;
  banner?: string;
  keyType?: string;
  fingerprint?: string;
  version?: string;
}

export async function collectSshFingerprint(host: string, port = 22): Promise<SshFingerprint> {
  const clean = host.replace(/[^a-zA-Z0-9.\-]/g, "");
  const result: SshFingerprint = { host: clean, port };

  // Get SSH banner
  await new Promise<void>((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(5000);

    socket.on("data", (data) => {
      const banner = data.toString("utf-8").trim();
      result.banner = banner;
      // Parse SSH version: SSH-2.0-OpenSSH_8.9p1
      const match = banner.match(/SSH-[\d.]+-(.+)/);
      if (match) result.version = match[1];
      socket.destroy();
      resolve();
    });
    socket.on("timeout", () => { socket.destroy(); resolve(); });
    socket.on("error", () => { socket.destroy(); resolve(); });
    socket.connect(port, clean);
  });

  // Get key fingerprint via ssh-keyscan
  const { stdout } = await execFileNoThrow("ssh-keyscan", ["-t", "ed25519,rsa", "-p", String(port), clean], { timeoutMs: 10000 });
  for (const line of stdout.split("\n")) {
    if (line.startsWith("#") || !line.trim()) continue;
    const parts = line.split(" ");
    if (parts.length >= 3) {
      result.keyType = parts[1]; // ssh-ed25519, ssh-rsa
      result.fingerprint = parts[2]?.slice(0, 50);
    }
  }

  return result;
}

// ── SSH Fingerprint Cross-Match ─────────────────────────

export interface SshCrossMatch {
  hosts: SshFingerprint[];
  matches: { host1: string; host2: string; matchType: "fingerprint" | "version" | "banner" }[];
  sameAdmin: boolean;
}

export async function crossMatchSsh(hosts: string[]): Promise<SshCrossMatch> {
  const fingerprints = await Promise.all(hosts.map(h => collectSshFingerprint(h)));
  const matches: SshCrossMatch["matches"] = [];

  for (let i = 0; i < fingerprints.length; i++) {
    for (let j = i + 1; j < fingerprints.length; j++) {
      const a = fingerprints[i], b = fingerprints[j];

      // Same SSH key fingerprint = same server or same admin
      if (a.fingerprint && b.fingerprint && a.fingerprint === b.fingerprint) {
        matches.push({ host1: a.host, host2: b.host, matchType: "fingerprint" });
      }
      // Same SSH version string (less significant but still useful)
      if (a.version && b.version && a.version === b.version) {
        matches.push({ host1: a.host, host2: b.host, matchType: "version" });
      }
    }
  }

  return {
    hosts: fingerprints,
    matches,
    sameAdmin: matches.some(m => m.matchType === "fingerprint"),
  };
}

// ── SPF / DKIM / DMARC Analysis ─────────────────────────

export interface EmailSecurityResult {
  domain: string;
  spf: SpfAnalysis;
  dkim: DkimAnalysis;
  dmarc: DmarcAnalysis;
  mailServers: string[];
  securityScore: number; // 0-100
  issues: string[];
}

export interface SpfAnalysis {
  exists: boolean;
  record?: string;
  mechanisms: string[];
  includes: string[];    // Other domains included → infrastructure links
  policy?: string;       // +all, -all, ~all, ?all
  tooPermissive: boolean;
}

export interface DkimAnalysis {
  exists: boolean;
  selectors: string[];   // Checked common selectors
  records: { selector: string; record: string }[];
}

export interface DmarcAnalysis {
  exists: boolean;
  record?: string;
  policy?: string;      // none, quarantine, reject
  rua?: string;         // Aggregate report email
  ruf?: string;         // Forensic report email
  pct?: number;         // Percentage
}

export async function analyzeEmailSecurity(domain: string): Promise<EmailSecurityResult> {
  const clean = domain.replace(/[^a-zA-Z0-9.\-]/g, "");
  const issues: string[] = [];

  // SPF
  const spf = await analyzeSpf(clean);
  if (!spf.exists) issues.push("No SPF record — email spoofing possible");
  else if (spf.tooPermissive) issues.push(`SPF policy is too permissive: ${spf.policy}`);

  // DKIM
  const dkim = await analyzeDkim(clean);
  if (!dkim.exists) issues.push("No DKIM records found — email authenticity unverifiable");

  // DMARC
  const dmarc = await analyzeDmarc(clean);
  if (!dmarc.exists) issues.push("No DMARC record — no domain-level email authentication policy");
  else if (dmarc.policy === "none") issues.push("DMARC policy is 'none' — monitoring only, not enforcing");

  // MX
  const { stdout: mxOut } = await execFileNoThrow("dig", ["+short", clean, "MX"], { timeoutMs: 5000 });
  const mailServers = mxOut.trim().split("\n").map(l => l.trim().split(/\s+/).pop()?.replace(/\.$/, "") || "").filter(Boolean);

  // Score
  let securityScore = 0;
  if (spf.exists && !spf.tooPermissive) securityScore += 30;
  else if (spf.exists) securityScore += 15;
  if (dkim.exists) securityScore += 30;
  if (dmarc.exists && dmarc.policy === "reject") securityScore += 40;
  else if (dmarc.exists && dmarc.policy === "quarantine") securityScore += 30;
  else if (dmarc.exists) securityScore += 10;

  return { domain: clean, spf, dkim, dmarc, mailServers, securityScore, issues };
}

async function analyzeSpf(domain: string): Promise<SpfAnalysis> {
  const { stdout } = await execFileNoThrow("dig", ["+short", domain, "TXT"], { timeoutMs: 5000 });
  const spfRecord = stdout.split("\n").find(l => l.includes("v=spf1"));

  if (!spfRecord) return { exists: false, mechanisms: [], includes: [], tooPermissive: false };

  const record = spfRecord.replace(/"/g, "").trim();
  const mechanisms = record.split(" ").filter(m => m && m !== "v=spf1");
  const includes = mechanisms.filter(m => m.startsWith("include:")).map(m => m.replace("include:", ""));
  const policy = mechanisms.find(m => m.endsWith("all")) || "";
  const tooPermissive = policy === "+all" || policy === "?all";

  return { exists: true, record, mechanisms, includes, policy, tooPermissive };
}

async function analyzeDkim(domain: string): Promise<DkimAnalysis> {
  const commonSelectors = ["default", "google", "selector1", "selector2", "k1", "k2", "dkim", "mail", "s1", "s2", "mandrill", "ses", "amazonses"];
  const records: { selector: string; record: string }[] = [];

  for (const selector of commonSelectors) {
    const { stdout } = await execFileNoThrow("dig", ["+short", `${selector}._domainkey.${domain}`, "TXT"], { timeoutMs: 3000 });
    const trimmed = stdout.trim();
    if (trimmed && trimmed.includes("v=DKIM1") || trimmed.includes("p=")) {
      records.push({ selector, record: trimmed.replace(/"/g, "").slice(0, 200) });
    }
  }

  return { exists: records.length > 0, selectors: records.map(r => r.selector), records };
}

async function analyzeDmarc(domain: string): Promise<DmarcAnalysis> {
  const { stdout } = await execFileNoThrow("dig", ["+short", `_dmarc.${domain}`, "TXT"], { timeoutMs: 5000 });
  const dmarcRecord = stdout.split("\n").find(l => l.includes("v=DMARC1"));

  if (!dmarcRecord) return { exists: false };

  const record = dmarcRecord.replace(/"/g, "").trim();
  const policy = record.match(/p=(\w+)/)?.[1];
  const rua = record.match(/rua=([^;]+)/)?.[1];
  const ruf = record.match(/ruf=([^;]+)/)?.[1];
  const pct = record.match(/pct=(\d+)/)?.[1];

  return { exists: true, record, policy, rua, ruf, pct: pct ? parseInt(pct) : undefined };
}

// ── SMTP Banner Intelligence ────────────────────────────

export interface SmtpBannerResult {
  host: string;
  port: number;
  banner?: string;
  hostname?: string;   // Internal hostname revealed
  software?: string;   // Postfix, Exim, Exchange
  tlsSupported: boolean;
  authMethods: string[];
}

export async function collectSmtpBanner(host: string, port = 25): Promise<SmtpBannerResult> {
  const clean = host.replace(/[^a-zA-Z0-9.\-]/g, "");
  const result: SmtpBannerResult = { host: clean, port, tlsSupported: false, authMethods: [] };

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let step = 0;
    let response = "";

    const done = () => { socket.destroy(); resolve(result); };

    socket.setTimeout(10000);
    socket.on("timeout", done);
    socket.on("error", done);

    socket.on("data", (data) => {
      const text = data.toString();
      response += text;

      if (step === 0 && text.startsWith("220")) {
        // Parse banner
        result.banner = text.trim();
        const hostnameMatch = text.match(/220\s+(\S+)/);
        if (hostnameMatch) result.hostname = hostnameMatch[1];

        // Detect software
        if (text.includes("Postfix")) result.software = "Postfix";
        else if (text.includes("Exim")) result.software = "Exim";
        else if (text.includes("Exchange")) result.software = "Microsoft Exchange";
        else if (text.includes("Sendmail")) result.software = "Sendmail";
        else if (text.includes("Dovecot")) result.software = "Dovecot";

        socket.write("EHLO probe.local\r\n");
        step = 1;
      } else if (step === 1) {
        if (text.includes("STARTTLS")) result.tlsSupported = true;
        if (text.includes("AUTH")) {
          const authMatch = text.match(/AUTH\s+(.+)/);
          if (authMatch) result.authMethods = authMatch[1].trim().split(/\s+/);
        }
        if (text.includes("250 ") || !text.includes("250-")) {
          socket.write("QUIT\r\n");
          setTimeout(done, 500);
        }
      }
    });

    socket.connect(port, clean);
  });
}
