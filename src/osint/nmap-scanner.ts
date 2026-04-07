/**
 * Nmap Deep Scanner — full port scan, service version, OS detection, NSE scripts
 * Replaces Shodan for active target scanning — no API key needed
 *
 * Requires: nmap installed (apt install nmap)
 */

import { execFileNoThrow } from "../utils/execFileNoThrow.js";

export interface NmapResult {
  target: string;
  scanType: string;
  ports: NmapPort[];
  osGuess: OsGuess[];
  hostScripts: ScriptResult[];
  traceroute: { hop: number; ip?: string; rtt?: string }[];
  scanTime: number;
  rawXml?: string;
  stats: {
    openPorts: number;
    closedPorts: number;
    filteredPorts: number;
    services: number;
  };
  timestamp: string;
}

export interface NmapPort {
  port: number;
  protocol: "tcp" | "udp";
  state: "open" | "closed" | "filtered" | "open|filtered";
  service: string;
  version?: string;
  product?: string;
  extraInfo?: string;
  cpe?: string;
  scripts: ScriptResult[];
}

export interface OsGuess {
  name: string;
  accuracy: number;
  family?: string;
  generation?: string;
}

export interface ScriptResult {
  id: string;
  output: string;
}

// ── Check nmap availability ─────────────────────────────

export async function isNmapAvailable(): Promise<boolean> {
  const { status } = await execFileNoThrow("nmap", ["--version"], { timeoutMs: 5000 });
  return status === 0;
}

// ── Parse nmap XML output ───────────────────────────────

function parseNmapXml(xml: string): Partial<NmapResult> {
  const ports: NmapPort[] = [];
  const osGuess: OsGuess[] = [];
  const hostScripts: ScriptResult[] = [];
  const traceroute: NmapResult["traceroute"] = [];

  // Parse ports
  const portMatches = xml.matchAll(/<port protocol="(\w+)" portid="(\d+)">([\s\S]*?)<\/port>/gi);
  for (const m of portMatches) {
    const block = m[3];
    const stateMatch = block.match(/state="(\w+)"/);
    const serviceMatch = block.match(/<service\s+([^>]+)\/?>/);
    const scripts: ScriptResult[] = [];

    // Parse scripts
    const scriptMatches = block.matchAll(/<script id="([^"]+)"[^>]*output="([^"]*)"[^>]*\/?>/gi);
    for (const sm of scriptMatches) {
      scripts.push({ id: sm[1], output: sm[2].replace(/&#xa;/g, "\n").slice(0, 500) });
    }
    // Also match multi-line script outputs
    const scriptBlocks = block.matchAll(/<script id="([^"]+)"[^>]*>([\s\S]*?)<\/script>/gi);
    for (const sb of scriptBlocks) {
      const output = sb[2].replace(/<[^>]+>/g, "").trim().slice(0, 500);
      if (output && !scripts.find(s => s.id === sb[1])) scripts.push({ id: sb[1], output });
    }

    let service = "", version = "", product = "", extraInfo = "", cpe = "";
    if (serviceMatch) {
      const attrs = serviceMatch[1];
      service = attrs.match(/name="([^"]+)"/)?.[1] || "";
      product = attrs.match(/product="([^"]+)"/)?.[1] || "";
      version = attrs.match(/version="([^"]+)"/)?.[1] || "";
      extraInfo = attrs.match(/extrainfo="([^"]+)"/)?.[1] || "";
      cpe = attrs.match(/cpe="([^"]+)"/)?.[1] || "";
    }

    ports.push({
      port: parseInt(m[2]),
      protocol: m[1] as any,
      state: (stateMatch?.[1] || "unknown") as any,
      service,
      version: version || undefined,
      product: product || undefined,
      extraInfo: extraInfo || undefined,
      cpe: cpe || undefined,
      scripts,
    });
  }

  // Parse OS detection
  const osMatches = xml.matchAll(/<osmatch name="([^"]+)" accuracy="(\d+)"[^>]*>/gi);
  for (const om of osMatches) {
    osGuess.push({ name: om[1], accuracy: parseInt(om[2]) });
  }

  // Parse host scripts
  const hostScriptMatches = xml.matchAll(/<hostscript>[\s\S]*?<script id="([^"]+)"[^>]*output="([^"]*)"[^>]*\/?>/gi);
  for (const hs of hostScriptMatches) {
    hostScripts.push({ id: hs[1], output: hs[2].replace(/&#xa;/g, "\n").slice(0, 500) });
  }

  // Parse traceroute
  const hops = xml.matchAll(/<hop ttl="(\d+)"[^>]*ipaddr="([^"]*)"[^>]*rtt="([^"]*)"/gi);
  for (const h of hops) {
    traceroute.push({ hop: parseInt(h[1]), ip: h[2], rtt: h[3] });
  }

  // Scan time
  const timeMatch = xml.match(/elapsed="([\d.]+)"/);
  const scanTime = timeMatch ? parseFloat(timeMatch[1]) : 0;

  return { ports, osGuess, hostScripts, traceroute, scanTime };
}

// ── Quick Scan (Top 1000 ports) ─────────────────────────

export async function nmapQuickScan(target: string): Promise<NmapResult> {
  const clean = target.replace(/[^a-zA-Z0-9.\-:]/g, "");

  const { stdout, stderr } = await execFileNoThrow(
    "nmap", ["-sV", "--version-intensity", "5", "--top-ports", "1000", "-oX", "-", "--open", "-T4", clean],
    { timeoutMs: 120000 }
  );

  const parsed = parseNmapXml(stdout);
  const openPorts = (parsed.ports || []).filter(p => p.state === "open");

  return {
    target: clean,
    scanType: "quick (top 1000)",
    ports: parsed.ports || [],
    osGuess: parsed.osGuess || [],
    hostScripts: parsed.hostScripts || [],
    traceroute: parsed.traceroute || [],
    scanTime: parsed.scanTime || 0,
    stats: {
      openPorts: openPorts.length,
      closedPorts: (parsed.ports || []).filter(p => p.state === "closed").length,
      filteredPorts: (parsed.ports || []).filter(p => p.state === "filtered").length,
      services: openPorts.filter(p => p.service).length,
    },
    timestamp: new Date().toISOString(),
  };
}

// ── Deep Scan (all ports + version + scripts) ───────────

export async function nmapDeepScan(target: string, options: {
  ports?: string;       // "1-65535" or "22,80,443"
  scripts?: string[];   // NSE script names
  udp?: boolean;
  osDetect?: boolean;
} = {}): Promise<NmapResult> {
  const clean = target.replace(/[^a-zA-Z0-9.\-:]/g, "");
  const args: string[] = [];

  // Port specification
  args.push("-p", options.ports || "1-10000");

  // Service version detection
  args.push("-sV");

  // Script scanning
  if (options.scripts?.length) {
    args.push("--script", options.scripts.join(","));
  } else {
    args.push("-sC"); // Default scripts
  }

  // OS detection
  if (options.osDetect) args.push("-O");

  // UDP scan
  if (options.udp) args.push("-sU");

  // Output XML + timing
  args.push("-oX", "-", "-T4", "--open", clean);

  const { stdout } = await execFileNoThrow("nmap", args, { timeoutMs: 300000 });
  const parsed = parseNmapXml(stdout);
  const openPorts = (parsed.ports || []).filter(p => p.state === "open");

  return {
    target: clean,
    scanType: `deep (ports: ${options.ports || "1-10000"}${options.udp ? " +UDP" : ""}${options.osDetect ? " +OS" : ""})`,
    ports: parsed.ports || [],
    osGuess: parsed.osGuess || [],
    hostScripts: parsed.hostScripts || [],
    traceroute: parsed.traceroute || [],
    scanTime: parsed.scanTime || 0,
    rawXml: stdout.length < 50000 ? stdout : undefined,
    stats: {
      openPorts: openPorts.length,
      closedPorts: (parsed.ports || []).filter(p => p.state === "closed").length,
      filteredPorts: (parsed.ports || []).filter(p => p.state === "filtered").length,
      services: openPorts.filter(p => p.service).length,
    },
    timestamp: new Date().toISOString(),
  };
}

// ── Vulnerability Scan (NSE vuln scripts) ───────────────

export async function nmapVulnScan(target: string): Promise<NmapResult> {
  return nmapDeepScan(target, {
    ports: "1-10000",
    scripts: ["vuln", "exploit", "auth"],
  });
}

// ── Specific NSE Script Categories ──────────────────────

export async function nmapScriptScan(target: string, category: "vuln" | "auth" | "default" | "discovery" | "safe"): Promise<NmapResult> {
  return nmapDeepScan(target, {
    ports: "1-1000",
    scripts: [category],
  });
}
