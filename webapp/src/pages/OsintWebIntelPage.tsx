import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch } from "../api/client";

interface TechStackResult { [category: string]: string | string[] }
interface WaybackResult { totalSnapshots: number; firstSeen: string; lastSeen: string }
interface DorkEntry { name: string; query: string }
interface FingerprintHeader { name: string; value: string }

const CATEGORY_ICONS: Record<string, string> = {
  JavaScript: "JS", CSS: "CSS", Analytics: "AN", CDN: "CDN", CMS: "CMS",
  Server: "SRV", Hosting: "HST", Security: "SEC", Framework: "FW", Meta: "MT",
};

function categoryLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").trim();
}

export default function OsintWebIntelPage() {
  const [params, setParams] = useSearchParams();
  const [url, setUrl] = useState(params.get("q") || "");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [techStack, setTechStack] = useState<TechStackResult | null>(null);
  const [wayback, setWayback] = useState<WaybackResult | null>(null);
  const [dorks, setDorks] = useState<DorkEntry[] | null>(null);
  const [robots, setRobots] = useState<string[] | null>(null);
  const [fingerprint, setFingerprint] = useState<FingerprintHeader[] | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    const q = params.get("q");
    if (q && q !== url) setUrl(q);
  }, [params]);

  const syncParams = useCallback((v: string) => {
    setUrl(v);
    if (v) setParams({ q: v }, { replace: true });
    else setParams({}, { replace: true });
  }, [setParams]);

  const domainFrom = (u: string) => {
    try { return new URL(u.startsWith("http") ? u : `https://${u}`).hostname; }
    catch { return u.replace(/^https?:\/\//, "").split("/")[0]; }
  };

  const runTechStack = useCallback(async () => {
    if (!url.trim()) return;
    setLoading("techstack"); setError(null);
    try {
      const res = await apiFetch(`/osint/techstack?url=${encodeURIComponent(url.trim())}`);
      const data = await res.json();
      setTechStack(data.data ?? data);
    } catch (e: any) { setError(e.message); } finally { setLoading(null); }
  }, [url]);

  const runWayback = useCallback(async () => {
    if (!url.trim()) return;
    setLoading("wayback"); setError(null);
    try {
      const res = await apiFetch(`/osint/wayback?url=${encodeURIComponent(url.trim())}`);
      const data = await res.json();
      setWayback(data.data ?? data);
    } catch (e: any) { setError(e.message); } finally { setLoading(null); }
  }, [url]);

  const runFullWebIntel = useCallback(async () => {
    if (!url.trim()) return;
    setLoading("full"); setError(null);
    try {
      const domain = domainFrom(url.trim());
      const [tsRes, wbRes, dkRes, fpRes] = await Promise.allSettled([
        apiFetch(`/osint/techstack?url=${encodeURIComponent(url.trim())}`).then(r => r.json()),
        apiFetch(`/osint/wayback?url=${encodeURIComponent(url.trim())}`).then(r => r.json()),
        apiFetch(`/osint/dorks/${encodeURIComponent(domain)}`).then(r => r.json()),
        apiFetch(`/osint/fingerprint?url=${encodeURIComponent(url.trim())}`).then(r => r.json()),
      ]);
      if (tsRes.status === "fulfilled") setTechStack(tsRes.value.data ?? tsRes.value);
      if (wbRes.status === "fulfilled") setWayback(wbRes.value.data ?? wbRes.value);
      if (dkRes.status === "fulfilled") {
        const d = dkRes.value.data ?? dkRes.value;
        setDorks(Array.isArray(d) ? d : Object.entries(d).map(([name, query]) => ({ name, query: String(query) })));
        if (dkRes.value.robots) setRobots(dkRes.value.robots.disallowed ?? dkRes.value.robots);
      }
      if (fpRes.status === "fulfilled") {
        const h = fpRes.value.data?.headers ?? fpRes.value.headers ?? fpRes.value;
        setFingerprint(Array.isArray(h) ? h : Object.entries(h).map(([name, value]) => ({ name, value: String(value) })));
      }
    } catch (e: any) { setError(e.message); } finally { setLoading(null); }
  }, [url]);

  const copyDork = (query: string, idx: number) => {
    navigator.clipboard.writeText(query);
    setCopied(idx);
    setTimeout(() => setCopied(null), 1500);
  };

  const hasResults = techStack || wayback || dorks || robots || fingerprint;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-osint-bg text-osint-text">
      {/* Header */}
      <div className="border-b border-osint-border px-6 py-5">
        <h1 className="text-xl font-bold text-osint-accent tracking-wide">Web Intelligence</h1>
        <p className="text-xs text-osint-muted mt-1">Tech stack, archives, dorks, fingerprinting</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Input */}
          <div className="bg-osint-panel border border-osint-border rounded-xl p-5">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-osint-accent font-mono text-sm">$</span>
                <input
                  type="text"
                  value={url}
                  onChange={e => syncParams(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !loading) runFullWebIntel(); }}
                  placeholder="https://example.com"
                  disabled={!!loading}
                  className="w-full pl-7 pr-4 py-3 text-sm bg-osint-input border border-osint-border rounded-lg focus:outline-none focus:ring-2 focus:ring-osint-accent/50 disabled:opacity-50 font-mono text-osint-text placeholder:text-osint-muted"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              {[
                { label: "Tech Stack", key: "techstack", fn: runTechStack },
                { label: "Wayback", key: "wayback", fn: runWayback },
                { label: "Full Web Intel", key: "full", fn: runFullWebIntel },
              ].map(btn => (
                <button
                  key={btn.key}
                  onClick={btn.fn}
                  disabled={!!loading || !url.trim()}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-osint-accent/40 text-osint-accent hover:bg-osint-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {loading === btn.key ? "Scanning..." : btn.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-950/50 border border-red-800 rounded-lg text-sm text-red-400">{error}</div>
          )}

          {loading && (
            <div className="text-center py-12">
              <div className="w-8 h-8 border-2 border-osint-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-osint-muted">Scanning target...</p>
            </div>
          )}

          {!loading && hasResults && (
            <div className="space-y-5">
              {/* Tech Stack Cards */}
              {techStack && (
                <section className="bg-osint-panel border border-osint-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-osint-border">
                    <h2 className="text-sm font-semibold text-osint-cyan">Technology Stack</h2>
                  </div>
                  <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                    {Object.entries(techStack).map(([cat, val]) => {
                      const items = Array.isArray(val) ? val : [val];
                      if (!items.length || (items.length === 1 && !items[0])) return null;
                      return (
                        <div key={cat} className="bg-osint-card border border-osint-border rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-[10px] font-bold bg-osint-accent/20 text-osint-accent px-1.5 py-0.5 rounded">
                              {CATEGORY_ICONS[cat] || cat.slice(0, 3).toUpperCase()}
                            </span>
                            <span className="text-xs font-medium text-osint-muted">{categoryLabel(cat)}</span>
                          </div>
                          <div className="space-y-1">
                            {items.map((v, i) => (
                              <div key={i} className="text-sm font-mono text-osint-text truncate">{v}</div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Wayback */}
              {wayback && (
                <section className="bg-osint-panel border border-osint-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-osint-border">
                    <h2 className="text-sm font-semibold text-osint-cyan">Wayback Machine</h2>
                  </div>
                  <div className="p-4 grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold text-osint-accent">{wayback.totalSnapshots?.toLocaleString() ?? "N/A"}</div>
                      <div className="text-xs text-osint-muted mt-1">Snapshots</div>
                    </div>
                    <div>
                      <div className="text-sm font-mono text-osint-text">{wayback.firstSeen || "N/A"}</div>
                      <div className="text-xs text-osint-muted mt-1">First Seen</div>
                    </div>
                    <div>
                      <div className="text-sm font-mono text-osint-text">{wayback.lastSeen || "N/A"}</div>
                      <div className="text-xs text-osint-muted mt-1">Last Seen</div>
                    </div>
                  </div>
                </section>
              )}

              {/* Google Dorks */}
              {dorks && dorks.length > 0 && (
                <section className="bg-osint-panel border border-osint-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-osint-border">
                    <h2 className="text-sm font-semibold text-osint-cyan">Google Dorks</h2>
                  </div>
                  <div className="p-4 space-y-2">
                    {dorks.map((d, i) => (
                      <div key={i} className="flex items-center gap-2 bg-osint-card border border-osint-border rounded-lg px-3 py-2">
                        <span className="text-xs text-osint-muted w-28 shrink-0 truncate">{d.name}</span>
                        <code className="flex-1 text-xs font-mono text-osint-text truncate">{d.query}</code>
                        <button onClick={() => copyDork(d.query, i)} className="text-xs text-osint-accent hover:text-osint-cyan shrink-0">
                          {copied === i ? "Copied" : "Copy"}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Robots.txt */}
              {robots && robots.length > 0 && (
                <section className="bg-osint-panel border border-osint-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-osint-border">
                    <h2 className="text-sm font-semibold text-osint-cyan">Robots.txt Disallowed</h2>
                  </div>
                  <div className="p-4">
                    <ul className="space-y-1">
                      {robots.map((path, i) => (
                        <li key={i} className="text-xs font-mono text-osint-text bg-osint-card border border-osint-border rounded px-3 py-1.5">{path}</li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}

              {/* HTTP Fingerprint */}
              {fingerprint && fingerprint.length > 0 && (
                <section className="bg-osint-panel border border-osint-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-osint-border">
                    <h2 className="text-sm font-semibold text-osint-cyan">HTTP Fingerprint</h2>
                  </div>
                  <div className="p-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-osint-border">
                          <th className="text-left py-2 pr-4 text-xs text-osint-muted font-medium">Header</th>
                          <th className="text-left py-2 text-xs text-osint-muted font-medium">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fingerprint.map((h, i) => (
                          <tr key={i} className="border-b border-osint-border/50 last:border-0">
                            <td className="py-2 pr-4 font-mono text-xs text-osint-accent whitespace-nowrap">{h.name}</td>
                            <td className="py-2 font-mono text-xs text-osint-text break-all">{h.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          )}

          {!loading && !hasResults && !error && (
            <div className="text-center py-16">
              <div className="text-4xl mb-3 opacity-40">{"</>"}</div>
              <p className="text-sm text-osint-muted">Enter a URL and select a scan type</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
