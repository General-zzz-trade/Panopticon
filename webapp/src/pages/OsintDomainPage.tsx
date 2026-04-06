import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch } from "../api/client";

type ScanType = "whois" | "dns" | "subdomains" | "certs" | "zone";

interface SectionResult {
  key: ScanType;
  label: string;
  data: any;
  error?: string;
}

const SCANS: { key: ScanType; label: string; endpoint: (d: string) => string }[] = [
  { key: "whois", label: "WHOIS", endpoint: (d) => `/osint/whois/${d}` },
  { key: "dns", label: "DNS", endpoint: (d) => `/osint/dns/${d}` },
  { key: "subdomains", label: "Subdomains", endpoint: (d) => `/osint/subdomains/${d}` },
  { key: "certs", label: "Certificates", endpoint: (d) => `/osint/certs/${d}` },
  { key: "zone", label: "Zone Transfer", endpoint: (d) => `/osint/dns/${d}` },
];

function DataTable({ rows }: { rows: string[][] }) {
  if (!rows || rows.length === 0) return <p className="text-osint-muted text-xs font-mono">No data.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-osint-border last:border-0">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`py-1.5 pr-4 font-mono text-xs ${
                    j === 0 ? "text-osint-cyan whitespace-nowrap" : "text-osint-text break-all"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function toRows(data: any, scanType: ScanType): string[][] {
  if (!data) return [];
  if (scanType === "whois") {
    return Object.entries(data).map(([k, v]) => [
      k,
      Array.isArray(v) ? v.join(", ") : String(v ?? "N/A"),
    ]);
  }
  if (scanType === "dns") {
    if (Array.isArray(data)) return data.map((r: any) => [r.type, r.value, r.priority != null ? `pri:${r.priority}` : ""]);
    if (data.records) return data.records.map((r: any) => [r.type, r.value, r.priority != null ? `pri:${r.priority}` : ""]);
    return Object.entries(data).map(([k, v]) => [k, String(v)]);
  }
  if (scanType === "subdomains") {
    const list = Array.isArray(data) ? data : data.subdomains || [];
    return list.map((s: any) =>
      typeof s === "string" ? [s] : [s.subdomain || s.name || "", s.ip || "", s.source || ""]
    );
  }
  if (scanType === "certs") {
    const list = Array.isArray(data) ? data : data.certs || data.certificates || [];
    return list.map((c: any) => [c.commonName || c.cn || "", c.issuer || "", c.validFrom || "", c.validTo || ""]);
  }
  if (scanType === "zone") {
    if (data.success === false) return [["Status", "Zone transfer not allowed"]];
    const recs = data.records || (Array.isArray(data) ? data : []);
    return recs.map((r: any) => (typeof r === "string" ? [r] : [r.name || "", r.type || "", r.value || ""]));
  }
  return Object.entries(data).map(([k, v]) => [k, String(v)]);
}

function CollapsibleSection({
  label,
  children,
  defaultOpen,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  return (
    <div className="border border-osint-border rounded bg-osint-card">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-osint-panel transition"
      >
        <span className="font-mono text-sm text-osint-accent font-semibold">{open ? "[-]" : "[+]"} {label}</span>
      </button>
      {open && <div className="px-4 pb-3 pt-1">{children}</div>}
    </div>
  );
}

export default function OsintDomainPage() {
  const [searchParams] = useSearchParams();
  const [domain, setDomain] = useState(searchParams.get("q") || "");
  const [loading, setLoading] = useState(false);
  const [activeScans, setActiveScans] = useState<Set<ScanType>>(new Set());
  const [results, setResults] = useState<SectionResult[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const q = searchParams.get("q");
    if (q && q !== domain) setDomain(q);
  }, [searchParams]);

  const runSingle = useCallback(
    async (scanType: ScanType) => {
      const d = domain.trim();
      if (!d) return;
      const scan = SCANS.find((s) => s.key === scanType)!;
      setActiveScans((prev) => new Set(prev).add(scanType));
      try {
        const res = await apiFetch(scan.endpoint(encodeURIComponent(d)));
        const json = await res.json();
        const data = json.data ?? json;
        setResults((prev) => {
          const filtered = prev.filter((r) => r.key !== scanType);
          return [...filtered, { key: scanType, label: scan.label, data }];
        });
      } catch (err) {
        setResults((prev) => {
          const filtered = prev.filter((r) => r.key !== scanType);
          return [...filtered, { key: scanType, label: scan.label, data: null, error: err instanceof Error ? err.message : "Scan failed" }];
        });
      } finally {
        setActiveScans((prev) => {
          const next = new Set(prev);
          next.delete(scanType);
          return next;
        });
      }
    },
    [domain]
  );

  const runAll = useCallback(async () => {
    const d = domain.trim();
    if (!d) return;
    setLoading(true);
    setResults([]);
    try {
      const res = await apiFetch("/osint/domain", {
        method: "POST",
        body: JSON.stringify({ target: d }),
      });
      const json = await res.json();
      const data = json.data ?? json;
      const sections: SectionResult[] = [];
      if (data.whois) sections.push({ key: "whois", label: "WHOIS", data: data.whois });
      if (data.dns) sections.push({ key: "dns", label: "DNS", data: data.dns });
      if (data.subdomains) sections.push({ key: "subdomains", label: "Subdomains", data: data.subdomains });
      if (data.certs || data.certificates) sections.push({ key: "certs", label: "Certificates", data: data.certs || data.certificates });
      if (data.zoneTransfer) sections.push({ key: "zone", label: "Zone Transfer", data: data.zoneTransfer });
      if (sections.length === 0) sections.push({ key: "whois", label: "Raw Result", data });
      setResults(sections);
    } catch (err) {
      setResults([{ key: "whois", label: "Error", data: null, error: err instanceof Error ? err.message : "Scan failed" }]);
    } finally {
      setLoading(false);
    }
  }, [domain]);

  const scanning = loading || activeScans.size > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-osint-bg text-osint-text">
      {/* Header */}
      <div className="border-b border-osint-border px-6 py-4 bg-osint-panel">
        <h1 className="font-mono text-lg text-osint-accent font-bold tracking-wider">
          {">"} DOMAIN RECON
        </h1>
        <p className="font-mono text-xs text-osint-muted mt-1">
          WHOIS / DNS / Subdomains / Certificates / Zone Transfer
        </p>
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-b border-osint-border bg-osint-panel">
        <div className="flex gap-3 items-center max-w-4xl">
          <span className="font-mono text-osint-accent text-sm font-bold">$</span>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !scanning) runAll(); }}
            placeholder="Enter domain..."
            disabled={scanning}
            className="flex-1 px-3 py-2 font-mono text-sm bg-osint-input border border-osint-border rounded text-osint-text placeholder:text-osint-muted focus:outline-none focus:border-osint-accent disabled:opacity-50"
          />
          <button
            onClick={runAll}
            disabled={scanning || !domain.trim()}
            className="px-4 py-2 font-mono text-xs font-bold bg-osint-accent text-osint-bg rounded hover:brightness-110 disabled:opacity-40 transition whitespace-nowrap"
          >
            Run All
          </button>
        </div>

        {/* Individual scan buttons */}
        <div className="flex gap-2 mt-3 max-w-4xl flex-wrap">
          {SCANS.map((scan) => (
            <button
              key={scan.key}
              onClick={() => runSingle(scan.key)}
              disabled={scanning || !domain.trim()}
              className="px-3 py-1.5 font-mono text-xs border border-osint-border rounded text-osint-cyan hover:bg-osint-card hover:border-osint-cyan disabled:opacity-40 transition"
            >
              {activeScans.has(scan.key) ? "..." : scan.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-3">
          {/* Loading */}
          {scanning && results.length === 0 && (
            <div className="text-center py-16">
              <div className="w-8 h-8 border-2 border-osint-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="font-mono text-sm text-osint-accent animate-pulse">SCANNING...</p>
              <p className="font-mono text-xs text-osint-muted mt-2">Enumerating target: {domain}</p>
            </div>
          )}

          {/* Results */}
          {results.map((section) => (
            <CollapsibleSection key={section.key} label={section.label} defaultOpen>
              {section.error ? (
                <p className="font-mono text-xs text-red-400">{section.error}</p>
              ) : (
                <DataTable rows={toRows(section.data, section.key)} />
              )}
            </CollapsibleSection>
          ))}

          {/* Empty state */}
          {!scanning && results.length === 0 && (
            <div className="text-center py-16">
              <p className="font-mono text-sm text-osint-muted">
                Enter a domain and run a scan to begin reconnaissance.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
