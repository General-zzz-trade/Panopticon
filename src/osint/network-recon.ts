/**
 * Network Reconnaissance — port scanning, IP geolocation, banner grabbing, traceroute
 * No external APIs — uses TCP connect + execFileNoThrow + free public services
 */

import { execFileNoThrow } from "../utils/execFileNoThrow.js";
import * as net from "net";

export interface PortResult {
  port: number;
  state: "open" | "closed" | "filtered";
  service?: string;
  banner?: string;
}

export interface GeoIpResult {
  ip: string;
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  lat?: number;
  lon?: number;
  isp?: string;
  org?: string;
  as?: string;
  timezone?: string;
  source: string;
}

export interface TracerouteHop {
  hop: number;
  ip?: string;
  hostname?: string;
  rtt: string[];
}

export interface BannerResult {
  port: number;
  banner: string;
  protocol?: string;
}

// ── Well-Known Port → Service Map ───────────────────────

const PORT_SERVICES: Record<number, string> = {
  21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
  80: "HTTP", 110: "POP3", 111: "RPCBind", 135: "MSRPC",
  139: "NetBIOS", 143: "IMAP", 443: "HTTPS", 445: "SMB",
  465: "SMTPS", 587: "Submission", 993: "IMAPS", 995: "POP3S",
  1433: "MSSQL", 1521: "Oracle", 2049: "NFS", 3306: "MySQL",
  3389: "RDP", 5432: "PostgreSQL", 5900: "VNC", 6379: "Redis",
  8080: "HTTP-Proxy", 8443: "HTTPS-Alt", 9200: "Elasticsearch",
  27017: "MongoDB", 11211: "Memcached",
};

function sanitizeHost(host: string): string {
  return host.replace(/[^a-zA-Z0-9.\-:]/g, "");
}

function sanitizeIp(ip: string): string {
  return ip.replace(/[^a-fA-F0-9.:]/g, "");
}

// ── TCP Port Scan ───────────────────────────────────────

function scanPort(host: string, port: number, timeoutMs = 3000): Promise<PortResult> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (state: "open" | "closed" | "filtered", banner?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ port, state, service: PORT_SERVICES[port], banner: banner?.trim() });
    };

    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      socket.once("data", (data) => {
        done("open", data.toString("utf-8").slice(0, 512));
      });
      setTimeout(() => done("open"), 1500);
    });

    socket.on("timeout", () => done("filtered"));
    socket.on("error", (err: any) => {
      if (err.code === "ECONNREFUSED") done("closed");
      else done("filtered");
    });

    socket.connect(port, host);
  });
}

export async function portScan(
  host: string,
  ports?: number[],
  options: { concurrency?: number; timeoutMs?: number } = {}
): Promise<PortResult[]> {
  const clean = sanitizeHost(host);
  const targetPorts = ports || [
    21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143,
    443, 445, 465, 587, 993, 995,
    1433, 1521, 2049, 3306, 3389, 5432, 5900, 6379,
    8080, 8443, 9200, 27017, 11211,
  ];
  const concurrency = options.concurrency || 20;
  const timeoutMs = options.timeoutMs || 3000;
  const results: PortResult[] = [];

  for (let i = 0; i < targetPorts.length; i += concurrency) {
    const batch = targetPorts.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(port => scanPort(clean, port, timeoutMs))
    );
    results.push(...batchResults);
  }

  return results.sort((a, b) => a.port - b.port);
}

// ── Banner Grabbing ─────────────────────────────────────

const BANNER_PROBES: Record<number, Buffer> = {
  21: Buffer.from(""),
  22: Buffer.from(""),
  25: Buffer.from("EHLO probe\r\n"),
  80: Buffer.from("HEAD / HTTP/1.0\r\nHost: target\r\n\r\n"),
  110: Buffer.from(""),
  143: Buffer.from(""),
  3306: Buffer.from(""),
  6379: Buffer.from("INFO\r\n"),
};

export async function grabBanner(host: string, port: number, timeoutMs = 5000): Promise<BannerResult> {
  const clean = sanitizeHost(host);

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let banner = "";
    let settled = false;

    const done = () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ port, banner: banner.trim(), protocol: PORT_SERVICES[port] });
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => {
      const probe = BANNER_PROBES[port];
      if (probe && probe.length > 0) socket.write(probe);
    });
    socket.on("data", (data) => {
      banner += data.toString("utf-8").slice(0, 1024);
      if (banner.length > 512) done();
    });
    socket.on("timeout", done);
    socket.on("error", done);
    socket.on("close", done);

    socket.connect(port, clean);
  });
}

// ── IP Geolocation (free services, no API key) ─────────

export async function geolocateIp(ip: string): Promise<GeoIpResult> {
  const clean = sanitizeIp(ip);

  // Source 1: ip-api.com (free, 45 req/min, no key)
  try {
    const response = await fetch(`http://ip-api.com/json/${clean}?fields=66846719`, {
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      const data = await response.json();
      if (data.status === "success") {
        return {
          ip: clean, country: data.country, countryCode: data.countryCode,
          region: data.regionName, city: data.city, lat: data.lat, lon: data.lon,
          isp: data.isp, org: data.org, as: data.as, timezone: data.timezone,
          source: "ip-api.com",
        };
      }
    }
  } catch {}

  // Source 2: ipinfo.io (free tier, no key for basic)
  try {
    const response = await fetch(`https://ipinfo.io/${clean}/json`, {
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      const data = await response.json();
      const [lat, lon] = (data.loc || "0,0").split(",").map(Number);
      return {
        ip: clean, country: data.country, region: data.region, city: data.city,
        lat, lon, org: data.org, timezone: data.timezone, source: "ipinfo.io",
      };
    }
  } catch {}

  // Source 3: geoiplookup if available locally
  const { stdout } = await execFileNoThrow("geoiplookup", [clean], { timeoutMs: 5000 });
  const match = stdout.match(/GeoIP Country Edition:\s*(\w+),\s*(.+)/);
  if (match) {
    return { ip: clean, countryCode: match[1], country: match[2].trim(), source: "geoiplookup" };
  }

  return { ip: clean, source: "none" };
}

// ── Traceroute ──────────────────────────────────────────

export async function traceroute(host: string, maxHops = 30): Promise<TracerouteHop[]> {
  const clean = sanitizeHost(host);
  const hops: TracerouteHop[] = [];

  let output = "";
  const tr = await execFileNoThrow("traceroute", ["-n", "-m", String(maxHops), "-w", "2", clean], { timeoutMs: 60000 });
  if (tr.status === 0) {
    output = tr.stdout;
  } else {
    const tp = await execFileNoThrow("tracepath", ["-n", clean], { timeoutMs: 60000 });
    output = tp.stdout;
  }

  for (const line of output.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.+)/);
    if (!match) continue;
    const hop = parseInt(match[1], 10);
    const rest = match[2].trim();

    if (rest.startsWith("*")) {
      hops.push({ hop, rtt: ["*"] });
      continue;
    }

    const ipMatch = rest.match(/(\d+\.\d+\.\d+\.\d+)/);
    const rttMatches = rest.match(/[\d.]+\s*ms/g) || [];
    hops.push({ hop, ip: ipMatch?.[1], rtt: rttMatches.map(r => r.trim()) });
  }

  return hops;
}

// ── HTTP Header Analysis ────────────────────────────────

export interface HttpHeaderAnalysis {
  url: string;
  statusCode: number;
  server?: string;
  poweredBy?: string;
  headers: Record<string, string>;
  securityHeaders: {
    hsts: boolean; csp: boolean; xFrameOptions: boolean;
    xContentType: boolean; xXssProtection: boolean;
    referrerPolicy: boolean; permissionsPolicy: boolean;
  };
  cookies: string[];
  redirectChain: string[];
}

export async function analyzeHttpHeaders(url: string): Promise<HttpHeaderAnalysis> {
  const result: HttpHeaderAnalysis = {
    url, statusCode: 0, headers: {},
    securityHeaders: {
      hsts: false, csp: false, xFrameOptions: false,
      xContentType: false, xXssProtection: false,
      referrerPolicy: false, permissionsPolicy: false,
    },
    cookies: [], redirectChain: [],
  };

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    result.statusCode = response.status;

    for (const [key, value] of response.headers.entries()) {
      result.headers[key] = value;
      const k = key.toLowerCase();

      if (k === "server") result.server = value;
      if (k === "x-powered-by") result.poweredBy = value;
      if (k === "strict-transport-security") result.securityHeaders.hsts = true;
      if (k === "content-security-policy") result.securityHeaders.csp = true;
      if (k === "x-frame-options") result.securityHeaders.xFrameOptions = true;
      if (k === "x-content-type-options") result.securityHeaders.xContentType = true;
      if (k === "x-xss-protection") result.securityHeaders.xXssProtection = true;
      if (k === "referrer-policy") result.securityHeaders.referrerPolicy = true;
      if (k === "permissions-policy") result.securityHeaders.permissionsPolicy = true;
      if (k === "set-cookie") result.cookies.push(value);
    }
  } catch {}

  return result;
}

// ── Full Network Recon ──────────────────────────────────

export interface NetworkReconResult {
  target: string;
  resolvedIp?: string;
  geo?: GeoIpResult;
  openPorts: PortResult[];
  banners: BannerResult[];
  httpHeaders?: HttpHeaderAnalysis;
  traceroute: TracerouteHop[];
  timestamp: string;
}

export async function fullNetworkRecon(target: string): Promise<NetworkReconResult> {
  let resolvedIp: string | undefined;
  const { stdout } = await execFileNoThrow("dig", ["+short", target, "A"], { timeoutMs: 5000 });
  resolvedIp = stdout.split("\n")[0]?.trim() || undefined;

  const scanTarget = resolvedIp || target;

  const [ports, geo, trace] = await Promise.all([
    portScan(scanTarget),
    geolocateIp(scanTarget),
    traceroute(scanTarget, 20),
  ]);

  const openPorts = ports.filter(p => p.state === "open");

  const banners = await Promise.all(
    openPorts.slice(0, 10).map(p => grabBanner(scanTarget, p.port))
  );

  let httpHeaders: HttpHeaderAnalysis | undefined;
  const hasHttps = openPorts.some(p => [443, 8443].includes(p.port));
  const hasHttp = openPorts.some(p => [80, 8080].includes(p.port));

  if (hasHttps) httpHeaders = await analyzeHttpHeaders(`https://${target}`);
  else if (hasHttp) httpHeaders = await analyzeHttpHeaders(`http://${target}`);

  return {
    target, resolvedIp, geo, openPorts,
    banners: banners.filter(b => b.banner),
    httpHeaders, traceroute: trace,
    timestamp: new Date().toISOString(),
  };
}
