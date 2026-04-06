/**
 * Reverse IP & ASN Reconnaissance — find co-hosted domains, map IP blocks
 * No API keys — uses free public services + shell commands
 */

import { execFileNoThrow } from "../utils/execFileNoThrow.js";

export interface ReverseIpResult {
  ip: string;
  domains: string[];
  source: string;
}

export interface AsnInfo {
  asn: string;
  name: string;
  country?: string;
  registry?: string;
  cidr?: string;
  description?: string;
}

export interface AsnPrefixes {
  asn: string;
  prefixes: { prefix: string; name?: string; country?: string }[];
}

export interface IpBlockInfo {
  cidr: string;
  netname?: string;
  description?: string;
  country?: string;
  abuse?: string;
  source: string;
}

// ── Reverse IP Lookup (find domains on same IP) ─────────

export async function reverseIpLookup(ip: string): Promise<ReverseIpResult> {
  const clean = ip.replace(/[^a-fA-F0-9.:]/g, "");
  const domains: string[] = [];

  // Source 1: HackerTarget (free, 100 req/day, no key)
  try {
    const response = await fetch(`https://api.hackertarget.com/reverseiplookup/?q=${clean}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) {
      const text = await response.text();
      if (!text.includes("error") && !text.includes("API count exceeded")) {
        for (const line of text.split("\n")) {
          const d = line.trim();
          if (d && d.includes(".") && !d.startsWith("No DNS")) {
            domains.push(d);
          }
        }
      }
    }
  } catch {}

  // Source 2: Reverse DNS via dig
  if (domains.length === 0) {
    const { stdout } = await execFileNoThrow("dig", ["+short", "-x", clean], { timeoutMs: 10000 });
    for (const line of stdout.split("\n")) {
      const h = line.trim().replace(/\.$/, "");
      if (h && h.includes(".")) domains.push(h);
    }
  }

  return { ip: clean, domains: [...new Set(domains)], source: domains.length > 0 ? "hackertarget" : "rdns" };
}

// ── ASN Lookup (via Team Cymru whois) ───────────────────

export async function asnLookup(ip: string): Promise<AsnInfo> {
  const clean = ip.replace(/[^0-9.]/g, "");
  const result: AsnInfo = { asn: "", name: "" };

  // Team Cymru IP-to-ASN mapping (free, whois-based)
  const { stdout } = await execFileNoThrow(
    "whois", ["-h", "whois.cymru.com", ` -v ${clean}`],
    { timeoutMs: 10000 }
  );

  // Parse: AS | IP | BGP Prefix | CC | Registry | Allocated | AS Name
  for (const line of stdout.split("\n")) {
    if (line.includes(clean) || (line.includes("|") && !line.startsWith("Bulk"))) {
      const parts = line.split("|").map(s => s.trim());
      if (parts.length >= 4 && /^\d+$/.test(parts[0])) {
        result.asn = `AS${parts[0]}`;
        result.cidr = parts[2] || undefined;
        result.country = parts[3] || undefined;
        result.registry = parts[4] || undefined;
        result.name = parts[parts.length - 1] || "";
      }
    }
  }

  // Fallback: RIPE/ARIN whois
  if (!result.asn) {
    const { stdout: whoisOut } = await execFileNoThrow("whois", [clean], { timeoutMs: 15000 });
    const originMatch = whoisOut.match(/origin(?:AS)?:\s*(AS\d+)/im);
    if (originMatch) result.asn = originMatch[1];
    const netnameMatch = whoisOut.match(/netname:\s*(.+)/im);
    if (netnameMatch) result.name = netnameMatch[1].trim();
    const cidrMatch = whoisOut.match(/(?:CIDR|route|inetnum):\s*(.+)/im);
    if (cidrMatch) result.cidr = cidrMatch[1].trim();
    const countryMatch = whoisOut.match(/country:\s*(\w+)/im);
    if (countryMatch) result.country = countryMatch[1].trim();
    const descMatch = whoisOut.match(/descr:\s*(.+)/im);
    if (descMatch) result.description = descMatch[1].trim();
  }

  return result;
}

// ── ASN Prefix Enumeration (what IP blocks does this AS own?) ──

export async function asnPrefixes(asn: string): Promise<AsnPrefixes> {
  const clean = asn.replace(/[^0-9]/g, "");
  const prefixes: { prefix: string; name?: string; country?: string }[] = [];

  // Use bgp.he.net (free, no key, scrape-based)
  try {
    const response = await fetch(`https://api.hackertarget.com/aslookup/?q=AS${clean}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) {
      const text = await response.text();
      if (!text.includes("error")) {
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (trimmed && (trimmed.includes("/") || trimmed.includes("."))) {
            // Could be "prefix, description" or just a prefix
            const parts = trimmed.split(",");
            prefixes.push({
              prefix: parts[0]?.trim() || trimmed,
              name: parts[1]?.trim(),
            });
          }
        }
      }
    }
  } catch {}

  // Fallback: RIPE STAT API (free, no key)
  if (prefixes.length === 0) {
    try {
      const response = await fetch(
        `https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS${clean}`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (response.ok) {
        const data = await response.json();
        for (const p of (data.data?.prefixes || [])) {
          prefixes.push({ prefix: p.prefix });
        }
      }
    } catch {}
  }

  return { asn: `AS${clean}`, prefixes };
}

// ── IP Block / CIDR Info ────────────────────────────────

export async function ipBlockInfo(ip: string): Promise<IpBlockInfo> {
  const clean = ip.replace(/[^0-9.]/g, "");
  const result: IpBlockInfo = { cidr: "", source: "whois" };

  const { stdout } = await execFileNoThrow("whois", [clean], { timeoutMs: 15000 });

  const cidrMatch = stdout.match(/CIDR:\s*(.+)/im) || stdout.match(/route:\s*(.+)/im) || stdout.match(/inetnum:\s*(.+)/im);
  if (cidrMatch) result.cidr = cidrMatch[1].trim();

  const netnameMatch = stdout.match(/netname:\s*(.+)/im) || stdout.match(/NetName:\s*(.+)/im);
  if (netnameMatch) result.netname = netnameMatch[1].trim();

  const descMatch = stdout.match(/descr:\s*(.+)/im) || stdout.match(/OrgName:\s*(.+)/im);
  if (descMatch) result.description = descMatch[1].trim();

  const countryMatch = stdout.match(/country:\s*(\w+)/im) || stdout.match(/Country:\s*(\w+)/im);
  if (countryMatch) result.country = countryMatch[1].trim();

  const abuseMatch = stdout.match(/abuse.*?:\s*(\S+@\S+)/im);
  if (abuseMatch) result.abuse = abuseMatch[1].trim();

  return result;
}

// ── Full ASN/Network Intelligence ───────────────────────

export interface NetworkIntelResult {
  ip: string;
  reverseIp: ReverseIpResult;
  asn: AsnInfo;
  prefixes: AsnPrefixes;
  ipBlock: IpBlockInfo;
  timestamp: string;
}

export async function fullNetworkIntel(ip: string): Promise<NetworkIntelResult> {
  const [reverseIp, asn, ipBlock] = await Promise.all([
    reverseIpLookup(ip),
    asnLookup(ip),
    ipBlockInfo(ip),
  ]);

  let prefixes: AsnPrefixes = { asn: "", prefixes: [] };
  if (asn.asn) {
    prefixes = await asnPrefixes(asn.asn);
  }

  return {
    ip,
    reverseIp,
    asn,
    prefixes,
    ipBlock,
    timestamp: new Date().toISOString(),
  };
}
