import React, { useState, useCallback } from "react";
import { apiFetch } from "../api/client";

type OsintModule = "investigate" | "domain" | "network" | "identity" | "web";

interface ModuleConfig {
  id: OsintModule;
  label: string;
  labelZh: string;
  icon: string;
  description: string;
  descriptionZh: string;
  placeholder: string;
}

const MODULES: ModuleConfig[] = [
  { id: "investigate", label: "Full Investigation", labelZh: "综合调查", icon: "🔍", description: "Complete OSINT recon: domain + network + web + risk assessment", descriptionZh: "完整OSINT侦查：域名+网络+Web+风险评估", placeholder: "example.com" },
  { id: "domain", label: "Domain Recon", labelZh: "域名侦查", icon: "🌐", description: "WHOIS, DNS, subdomains, certificates, zone transfer", descriptionZh: "WHOIS、DNS记录、子域名、证书透明度、区域传输", placeholder: "example.com" },
  { id: "network", label: "Network Scan", labelZh: "网络扫描", icon: "📡", description: "Port scan, geolocation, banner grab, traceroute, HTTP headers", descriptionZh: "端口扫描、地理定位、Banner抓取、路由追踪", placeholder: "93.184.216.34" },
  { id: "identity", label: "Identity Lookup", labelZh: "身份查询", icon: "👤", description: "Username enumeration across 35+ platforms, email validation", descriptionZh: "跨35+平台用户名枚举、邮箱验证", placeholder: "johndoe or user@example.com" },
  { id: "web", label: "Web Intel", labelZh: "Web情报", icon: "🕸️", description: "Tech stack, Wayback Machine, robots.txt, Google dorks", descriptionZh: "技术栈检测、历史快照、robots分析、Google Dork", placeholder: "https://example.com" },
];

interface ResultSection {
  title: string;
  type: "table" | "list" | "text" | "risk" | "graph";
  data: any;
}

function RiskBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-600 text-white",
    high: "bg-orange-500 text-white",
    medium: "bg-yellow-500 text-gray-900",
    low: "bg-green-500 text-white",
  };
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${colors[level] || "bg-gray-500 text-white"}`}>
      {level}
    </span>
  );
}

function ResultsView({ data, module }: { data: any; module: OsintModule }) {
  if (!data) return null;

  const sections: ResultSection[] = [];

  if (module === "investigate" || module === "domain") {
    const d = module === "investigate" ? data.data?.domain : data.data;
    if (d) {
      // WHOIS
      if (d.whois) {
        sections.push({
          title: "WHOIS",
          type: "table",
          data: [
            ["Registrar", d.whois.registrar || "N/A"],
            ["Created", d.whois.createdDate || "N/A"],
            ["Expires", d.whois.expiryDate || "N/A"],
            ["Organization", d.whois.registrantOrg || "N/A"],
            ["Country", d.whois.registrantCountry || "N/A"],
            ["Name Servers", (d.whois.nameServers || []).join(", ") || "N/A"],
            ["DNSSEC", d.whois.dnssec || "N/A"],
          ],
        });
      }
      // DNS
      if (d.dns?.length > 0) {
        sections.push({
          title: `DNS Records (${d.dns.length})`,
          type: "table",
          data: d.dns.map((r: any) => [r.type, r.value, r.priority !== undefined ? `Priority: ${r.priority}` : ""]),
        });
      }
      // Subdomains
      if (d.subdomains?.length > 0) {
        sections.push({
          title: `Subdomains (${d.subdomains.length})`,
          type: "table",
          data: d.subdomains.map((s: any) => [s.subdomain, s.source, s.ip || "N/A"]),
        });
      }
      // Zone Transfer
      if (d.zoneTransfer?.success) {
        sections.push({
          title: "⚠️ Zone Transfer ENABLED",
          type: "list",
          data: d.zoneTransfer.records.slice(0, 20),
        });
      }
    }
  }

  if (module === "investigate" || module === "network") {
    const n = module === "investigate" ? data.data?.network : data.data;
    if (n) {
      // Geo
      if (n.geo) {
        sections.push({
          title: "Geolocation",
          type: "table",
          data: [
            ["IP", n.resolvedIp || n.target],
            ["Country", n.geo.country || "N/A"],
            ["Region", n.geo.region || "N/A"],
            ["City", n.geo.city || "N/A"],
            ["ISP", n.geo.isp || "N/A"],
            ["Organization", n.geo.org || "N/A"],
            ["AS", n.geo.as || "N/A"],
            ["Coordinates", n.geo.lat && n.geo.lon ? `${n.geo.lat}, ${n.geo.lon}` : "N/A"],
          ],
        });
      }
      // Ports
      const open = (n.openPorts || []).filter((p: any) => p.state === "open");
      if (open.length > 0) {
        sections.push({
          title: `Open Ports (${open.length})`,
          type: "table",
          data: open.map((p: any) => [String(p.port), p.service || "Unknown", (p.banner || "").slice(0, 80)]),
        });
      }
      // Security Headers
      if (n.httpHeaders?.securityHeaders) {
        const sec = n.httpHeaders.securityHeaders;
        sections.push({
          title: "Security Headers",
          type: "table",
          data: [
            ["HSTS", sec.hsts ? "✅" : "❌"],
            ["CSP", sec.csp ? "✅" : "❌"],
            ["X-Frame-Options", sec.xFrameOptions ? "✅" : "❌"],
            ["X-Content-Type", sec.xContentType ? "✅" : "❌"],
            ["Referrer-Policy", sec.referrerPolicy ? "✅" : "❌"],
          ],
        });
      }
    }
  }

  if (module === "investigate" || module === "identity") {
    const id = module === "investigate" ? data.data?.identity : data.data;
    if (id) {
      const found = (id.foundProfiles || id.usernameResults?.filter((r: any) => r.exists) || []);
      if (found.length > 0) {
        sections.push({
          title: `Found Profiles (${found.length})`,
          type: "table",
          data: found.map((p: any) => [p.platform, p.url]),
        });
      }
      if (id.emailValidation) {
        sections.push({
          title: "Email Validation",
          type: "table",
          data: [
            ["Format Valid", id.emailValidation.format ? "✅" : "❌"],
            ["MX Records", (id.emailValidation.mxRecords || []).join(", ") || "None"],
            ["Disposable", id.emailValidation.disposable ? "⚠️ Yes" : "No"],
            ["Role Account", id.emailValidation.role ? "Yes" : "No"],
            ["SMTP Reachable", id.emailValidation.smtpReachable === true ? "✅" : id.emailValidation.smtpReachable === false ? "❌" : "N/A"],
          ],
        });
      }
    }
  }

  if (module === "investigate" || module === "web") {
    const w = module === "investigate" ? data.data?.web : data.data;
    if (w) {
      if (w.techStack) {
        const stack = [];
        if (w.techStack.server) stack.push(["Server", w.techStack.server]);
        if (w.techStack.cms) stack.push(["CMS", w.techStack.cms]);
        if (w.techStack.cdn) stack.push(["CDN", w.techStack.cdn]);
        if (w.techStack.hosting) stack.push(["Hosting", w.techStack.hosting]);
        if (w.techStack.javascript?.length) stack.push(["JavaScript", w.techStack.javascript.join(", ")]);
        if (w.techStack.css?.length) stack.push(["CSS", w.techStack.css.join(", ")]);
        if (w.techStack.analytics?.length) stack.push(["Analytics", w.techStack.analytics.join(", ")]);
        if (w.techStack.security?.length) stack.push(["Security", w.techStack.security.join(", ")]);
        if (stack.length) {
          sections.push({ title: "Technology Stack", type: "table", data: stack });
        }
      }
      if (w.wayback) {
        sections.push({
          title: "Wayback Machine",
          type: "table",
          data: [
            ["Total Snapshots", String(w.wayback.totalSnapshots)],
            ["First Seen", w.wayback.firstSeen || "N/A"],
            ["Last Seen", w.wayback.lastSeen || "N/A"],
          ],
        });
      }
      if (w.dorks) {
        sections.push({
          title: "Google Dork Queries",
          type: "list",
          data: Object.entries(w.dorks).map(([name, query]) => `${name}: ${query}`),
        });
      }
    }
  }

  // Risk assessment (for full investigation)
  if (module === "investigate" && data.riskLevel) {
    sections.unshift({
      title: "Risk Assessment",
      type: "risk",
      data: { level: data.riskLevel, factors: data.riskFactors || [], recommendations: data.recommendations || [] },
    });
  }

  // Graph stats
  if (module === "investigate" && data.stats) {
    sections.push({
      title: "Intelligence Graph",
      type: "graph",
      data: data.stats,
    });
  }

  return (
    <div className="space-y-6">
      {sections.map((section, idx) => (
        <div key={idx} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
            <h3 className="text-sm font-semibold">{section.title}</h3>
          </div>
          <div className="p-4">
            {section.type === "risk" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">Risk Level:</span>
                  <RiskBadge level={section.data.level} />
                </div>
                {section.data.factors.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Risk Factors</p>
                    <ul className="space-y-1">
                      {section.data.factors.map((f: string, i: number) => (
                        <li key={i} className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
                          <span className="mt-0.5">⚠️</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {section.data.recommendations.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Recommendations</p>
                    <ol className="space-y-1 list-decimal list-inside">
                      {section.data.recommendations.map((r: string, i: number) => (
                        <li key={i} className="text-sm text-gray-700 dark:text-gray-300">{r}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}

            {section.type === "table" && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {section.data.map((row: string[], i: number) => (
                      <tr key={i} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                        <td className="py-2 pr-4 font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap">{row[0]}</td>
                        <td className="py-2 text-gray-900 dark:text-gray-100 break-all">{row[1]}</td>
                        {row[2] && <td className="py-2 pl-4 text-gray-400 text-xs">{row[2]}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {section.type === "list" && (
              <ul className="space-y-1">
                {section.data.map((item: string, i: number) => (
                  <li key={i} className="text-sm text-gray-700 dark:text-gray-300 font-mono text-xs break-all">
                    {item}
                  </li>
                ))}
              </ul>
            )}

            {section.type === "graph" && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(section.data).map(([key, val]) => (
                  <div key={key} className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600">{String(val)}</div>
                    <div className="text-xs text-gray-500 capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</div>
                  </div>
                ))}
              </div>
            )}

            {section.type === "text" && (
              <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">{section.data}</pre>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function OsintPage() {
  const [activeModule, setActiveModule] = useState<OsintModule>("investigate");
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ module: OsintModule; target: string; timestamp: string; riskLevel?: string }[]>([]);

  const runInvestigation = useCallback(async () => {
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const endpoint = activeModule === "investigate"
        ? "/osint/investigate"
        : `/osint/${activeModule}`;

      const res = await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ target: target.trim(), type: activeModule === "investigate" ? "full" : undefined }),
      });
      const data = await res.json();

      if (!data.success) throw new Error(data.error || "Investigation failed");

      setResult(data);
      setHistory(h => [{
        module: activeModule,
        target: target.trim(),
        timestamp: new Date().toISOString(),
        riskLevel: data.riskLevel,
      }, ...h.slice(0, 19)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Investigation failed");
    } finally {
      setLoading(false);
    }
  }, [target, activeModule]);

  const currentModule = MODULES.find(m => m.id === activeModule)!;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <span className="text-2xl">🕵️</span>
              OSINT Intelligence
            </h1>
            <p className="text-xs text-gray-500 mt-1">Open Source Intelligence — No API Keys Required</p>
          </div>
          {history.length > 0 && (
            <div className="text-xs text-gray-400">
              {history.length} investigation{history.length > 1 ? "s" : ""} this session
            </div>
          )}
        </div>

        {/* Module Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {MODULES.map(mod => (
            <button
              key={mod.id}
              onClick={() => { setActiveModule(mod.id); setResult(null); setError(null); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm whitespace-nowrap transition ${
                activeModule === mod.id
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              <span>{mod.icon}</span>
              <span className="font-medium">{mod.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">
          {/* Module Description + Input */}
          <div className="mb-6 bg-gray-50 dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
            <div className="flex items-start gap-4 mb-4">
              <div className="text-3xl">{currentModule.icon}</div>
              <div>
                <h2 className="font-bold text-lg">{currentModule.label}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{currentModule.description}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={target}
                  onChange={e => setTarget(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !loading) runInvestigation(); }}
                  placeholder={currentModule.placeholder}
                  disabled={loading}
                  className="w-full px-4 py-3 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 font-mono"
                />
                {loading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
              <button
                onClick={runInvestigation}
                disabled={loading || !target.trim()}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium rounded-xl transition text-sm whitespace-nowrap"
              >
                {loading ? "Investigating..." : "Investigate"}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="text-center py-16">
              <div className="w-12 h-12 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm text-gray-500">Running {currentModule.label}...</p>
              <p className="text-xs text-gray-400 mt-1">This may take 30-60 seconds for comprehensive scans</p>
            </div>
          )}

          {/* Results */}
          {!loading && result && (
            <div>
              {/* Duration */}
              {result.durationMs && (
                <div className="mb-4 text-xs text-gray-400 text-right">
                  Completed in {(result.durationMs / 1000).toFixed(1)}s
                </div>
              )}

              <ResultsView data={result} module={activeModule} />

              {/* Report Markdown (for full investigation) */}
              {result.report && typeof result.report === "string" && (
                <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Full Report</h3>
                    <button
                      onClick={() => {
                        const blob = new Blob([result.report], { type: "text/markdown" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `osint-report-${target.replace(/[^a-zA-Z0-9]/g, "-")}.md`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      Download .md
                    </button>
                  </div>
                  <pre className="p-4 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono max-h-96 overflow-y-auto">
                    {result.report}
                  </pre>
                </div>
              )}

              {/* Raw JSON */}
              <details className="mt-4">
                <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                  View Raw JSON
                </summary>
                <pre className="mt-2 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl text-xs text-gray-600 dark:text-gray-400 overflow-x-auto max-h-96 font-mono border border-gray-200 dark:border-gray-800">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </div>
          )}

          {/* Empty State */}
          {!loading && !result && !error && (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">{currentModule.icon}</div>
              <h3 className="text-lg font-semibold mb-2">{currentModule.label}</h3>
              <p className="text-sm text-gray-500 max-w-md mx-auto">{currentModule.description}</p>
              <p className="text-xs text-gray-400 mt-4">Enter a target above and click Investigate to start</p>

              {/* Quick Examples */}
              <div className="mt-8 flex flex-wrap justify-center gap-2">
                {["example.com", "github.com", "cloudflare.com", "8.8.8.8"].map(example => (
                  <button
                    key={example}
                    onClick={() => setTarget(example)}
                    className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* History */}
          {history.length > 0 && !loading && (
            <div className="mt-8 border-t border-gray-200 dark:border-gray-800 pt-6">
              <h3 className="text-sm font-semibold mb-3 text-gray-500">Recent Investigations</h3>
              <div className="space-y-2">
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => { setTarget(h.target); setActiveModule(h.module); }}
                    className="w-full flex items-center gap-3 px-4 py-2 bg-gray-50 dark:bg-gray-900 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition text-left"
                  >
                    <span>{MODULES.find(m => m.id === h.module)?.icon}</span>
                    <span className="text-sm font-mono flex-1">{h.target}</span>
                    {h.riskLevel && <RiskBadge level={h.riskLevel} />}
                    <span className="text-xs text-gray-400">{new Date(h.timestamp).toLocaleTimeString()}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
