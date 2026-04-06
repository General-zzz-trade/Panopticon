import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api/client';

const GraphVisualization = lazy(() => import('../components/GraphVisualization'));

function RiskBadge({ level }: { level: string }) {
  const cfg: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-400 border-red-500/30 glow-red',
    high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    low: 'bg-green-500/20 text-osint-accent border-green-500/30 glow-green',
  };
  return (
    <span className={`px-3 py-1 rounded border text-xs font-mono font-bold uppercase tracking-wider ${cfg[level] || 'bg-gray-500/20 text-gray-400'}`}>
      {level}
    </span>
  );
}

function DataTable({ rows, headers }: { rows: string[][]; headers?: string[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        {headers && (
          <thead>
            <tr className="border-b border-osint-border">
              {headers.map((h, i) => <th key={i} className="text-left py-2 px-3 text-osint-muted font-semibold">{h}</th>)}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-osint-border/50 hover:bg-white/[.02]">
              {row.map((cell, j) => (
                <td key={j} className={`py-1.5 px-3 ${j === 0 ? 'text-osint-cyan' : 'text-osint-text/80'} break-all`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children, severity }: { title: string; children: React.ReactNode; severity?: string }) {
  const [open, setOpen] = useState(true);
  const borderColor = severity === 'high' ? 'border-red-500/30' : severity === 'medium' ? 'border-amber-500/30' : 'border-osint-border';
  return (
    <div className={`bg-osint-panel border ${borderColor} rounded-lg overflow-hidden`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-2.5 bg-osint-card/50 hover:bg-osint-card transition">
        <span className="text-xs font-semibold text-osint-accent tracking-wide">{title}</span>
        <span className="text-osint-muted text-xs">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

export default function OsintInvestigate({ chat }: { chat?: any }) {
  const [searchParams] = useSearchParams();
  const [target, setTarget] = useState(searchParams.get('q') || '');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');

  useEffect(() => {
    const q = searchParams.get('q');
    if (q && !result && !loading) { setTarget(q); runInvestigation(q); }
  }, []);

  const runInvestigation = useCallback(async (t?: string) => {
    const tgt = (t || target).trim();
    if (!tgt) return;
    setLoading(true); setError(null); setResult(null);
    setProgress('Initializing investigation...');

    try {
      const progressSteps = ['Querying WHOIS...', 'Enumerating DNS records...', 'Discovering subdomains...', 'Scanning ports...', 'Geolocating IP...', 'Analyzing tech stack...', 'Checking Wayback Machine...', 'Generating report...'];
      let step = 0;
      const iv = setInterval(() => { if (step < progressSteps.length) setProgress(progressSteps[step++]); }, 3000);

      const res = await apiFetch('/osint/investigate', {
        method: 'POST',
        body: JSON.stringify({ target: tgt, type: 'full' }),
      });
      clearInterval(iv);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Investigation failed');
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Investigation failed');
    } finally {
      setLoading(false); setProgress('');
    }
  }, [target]);

  return (
    <div className="flex-1 overflow-y-auto bg-osint-bg p-6">
      <div className="max-w-5xl mx-auto space-y-5">

        {/* Input */}
        <div className="bg-osint-panel border border-osint-border rounded-xl p-5">
          <h2 className="text-xs font-bold text-osint-muted tracking-[.15em] uppercase mb-3">FULL INVESTIGATION</h2>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-osint-accent font-mono text-sm">$</div>
              <input
                type="text" value={target}
                onChange={e => setTarget(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !loading) runInvestigation(); }}
                placeholder="Domain, IP, email, or username..."
                disabled={loading}
                className="w-full pl-7 pr-4 py-3 bg-osint-input border border-osint-border rounded-lg text-sm font-mono text-osint-text placeholder-osint-muted/50 focus:outline-none focus:border-osint-accent/40 transition disabled:opacity-50"
              />
            </div>
            <button onClick={() => runInvestigation()} disabled={loading || !target.trim()}
              className="px-6 py-3 bg-osint-accent/10 border border-osint-accent/30 text-osint-accent font-mono text-sm rounded-lg hover:bg-osint-accent/20 disabled:opacity-30 transition glow-green">
              {loading ? 'SCANNING...' : 'LAUNCH'}
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="bg-osint-panel border border-osint-accent/20 rounded-xl p-8 text-center glow-green">
            <div className="spinner w-8 h-8 mx-auto mb-4" />
            <p className="text-sm text-osint-accent font-mono">{progress}</p>
            <p className="text-xs text-osint-muted mt-2">Full investigation may take 60-90 seconds</p>
            <div className="mt-4 flex justify-center gap-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="w-8 h-1 rounded-full bg-osint-accent/20" style={{ animationDelay: `${i * 0.15}s` }}>
                  <div className="h-full rounded-full bg-osint-accent/60 animate-pulse" style={{ animationDelay: `${i * 0.15}s` }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400 font-mono">
            ERROR: {error}
          </div>
        )}

        {/* Results */}
        {!loading && result && (
          <div className="space-y-4">
            {/* Risk + Duration Header */}
            <div className="flex items-center justify-between bg-osint-panel border border-osint-border rounded-xl p-4">
              <div className="flex items-center gap-4">
                <RiskBadge level={result.riskLevel} />
                <div>
                  <span className="text-sm font-mono text-osint-text">Target: </span>
                  <span className="text-sm font-mono text-osint-accent">{result.data?.target || target}</span>
                </div>
              </div>
              <div className="text-xs font-mono text-osint-muted">
                {(result.durationMs / 1000).toFixed(1)}s | {result.stats?.entityCount || 0} entities | {result.stats?.relationCount || 0} relations
              </div>
            </div>

            {/* Risk Factors */}
            {result.riskFactors?.length > 0 && (
              <Section title="RISK FACTORS" severity="high">
                <div className="space-y-2">
                  {result.riskFactors.map((f: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-red-400 mt-0.5">▸</span>
                      <span className="text-osint-text/80">{f}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Recommendations */}
            {result.recommendations?.length > 0 && (
              <Section title="RECOMMENDATIONS">
                <ol className="space-y-1.5 list-decimal list-inside text-sm text-osint-text/80">
                  {result.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}
                </ol>
              </Section>
            )}

            {/* Domain Intel */}
            {result.data?.domain && (
              <Section title={`DOMAIN — ${result.data.domain.dns?.length || 0} DNS records, ${result.data.domain.subdomains?.length || 0} subdomains`}>
                {result.data.domain.whois && (
                  <div className="mb-4">
                    <p className="text-[10px] text-osint-muted tracking-wider uppercase mb-2">WHOIS</p>
                    <DataTable rows={[
                      ['Registrar', result.data.domain.whois.registrar || 'N/A'],
                      ['Created', result.data.domain.whois.createdDate || 'N/A'],
                      ['Expires', result.data.domain.whois.expiryDate || 'N/A'],
                      ['Organization', result.data.domain.whois.registrantOrg || 'N/A'],
                      ['Country', result.data.domain.whois.registrantCountry || 'N/A'],
                      ['Name Servers', (result.data.domain.whois.nameServers || []).join(', ') || 'N/A'],
                    ]} />
                  </div>
                )}
                {result.data.domain.dns?.length > 0 && (
                  <div className="mb-4">
                    <p className="text-[10px] text-osint-muted tracking-wider uppercase mb-2">DNS RECORDS</p>
                    <DataTable headers={['Type', 'Value', 'Priority']}
                      rows={result.data.domain.dns.slice(0, 20).map((r: any) => [r.type, r.value, r.priority !== undefined ? String(r.priority) : ''])} />
                  </div>
                )}
                {result.data.domain.subdomains?.length > 0 && (
                  <div>
                    <p className="text-[10px] text-osint-muted tracking-wider uppercase mb-2">SUBDOMAINS ({result.data.domain.subdomains.length})</p>
                    <DataTable headers={['Subdomain', 'Source', 'IP']}
                      rows={result.data.domain.subdomains.slice(0, 30).map((s: any) => [s.subdomain, s.source, s.ip || '—'])} />
                  </div>
                )}
              </Section>
            )}

            {/* Network Intel */}
            {result.data?.network && (() => {
              const n = result.data.network;
              const open = (n.openPorts || []).filter((p: any) => p.state === 'open');
              return (
                <Section title={`NETWORK — ${open.length} open ports`}>
                  {n.geo && (
                    <div className="mb-4">
                      <p className="text-[10px] text-osint-muted tracking-wider uppercase mb-2">GEOLOCATION</p>
                      <DataTable rows={[
                        ['IP', n.resolvedIp || n.target], ['Country', n.geo.country || 'N/A'],
                        ['City', n.geo.city || 'N/A'], ['ISP', n.geo.isp || 'N/A'],
                        ['Org', n.geo.org || 'N/A'], ['AS', n.geo.as || 'N/A'],
                        ['Coords', n.geo.lat && n.geo.lon ? `${n.geo.lat}, ${n.geo.lon}` : 'N/A'],
                      ]} />
                    </div>
                  )}
                  {open.length > 0 && (
                    <div className="mb-4">
                      <p className="text-[10px] text-osint-muted tracking-wider uppercase mb-2">OPEN PORTS</p>
                      <DataTable headers={['Port', 'Service', 'Banner']}
                        rows={open.map((p: any) => [String(p.port), p.service || 'Unknown', (p.banner || '').slice(0, 60)])} />
                    </div>
                  )}
                  {n.httpHeaders?.securityHeaders && (
                    <div>
                      <p className="text-[10px] text-osint-muted tracking-wider uppercase mb-2">SECURITY HEADERS</p>
                      <DataTable rows={Object.entries(n.httpHeaders.securityHeaders).map(([k, v]) => [k, v ? '✓ Present' : '✗ Missing'])} />
                    </div>
                  )}
                </Section>
              );
            })()}

            {/* Web Intel */}
            {result.data?.web && (
              <Section title="WEB INTELLIGENCE">
                {result.data.web.techStack && (
                  <div className="mb-4">
                    <p className="text-[10px] text-osint-muted tracking-wider uppercase mb-2">TECHNOLOGY STACK</p>
                    <DataTable rows={[
                      ['Server', result.data.web.techStack.server || 'N/A'],
                      ['CMS', result.data.web.techStack.cms || 'None'],
                      ['CDN', result.data.web.techStack.cdn || 'None'],
                      ['Hosting', result.data.web.techStack.hosting || 'N/A'],
                      ['JavaScript', result.data.web.techStack.javascript?.join(', ') || 'None'],
                      ['Analytics', result.data.web.techStack.analytics?.join(', ') || 'None'],
                    ]} />
                  </div>
                )}
                <DataTable rows={[
                  ['Wayback Snapshots', String(result.data.web.wayback?.totalSnapshots || 0)],
                  ['Internal Links', String(result.data.web.links?.internal || 0)],
                  ['External Links', String(result.data.web.links?.external || 0)],
                  ['Robots Disallowed', String(result.data.web.robots?.disallowed?.length || 0)],
                ]} />
              </Section>
            )}

            {/* Intelligence Graph */}
            {result.stats && (
              <Section title="INTELLIGENCE GRAPH">
                <div className="grid grid-cols-4 gap-3 mb-4">
                  {Object.entries(result.stats).map(([k, v]) => (
                    <div key={k} className="bg-osint-bg border border-osint-border rounded-lg p-3 text-center">
                      <div className="text-xl font-bold font-mono text-osint-accent">{String(v)}</div>
                      <div className="text-[10px] text-osint-muted capitalize font-mono">{k.replace(/([A-Z])/g, ' $1').trim()}</div>
                    </div>
                  ))}
                </div>
                {result.data?.graph?.entities && result.data.graph.entities.length > 0 && (
                  <Suspense fallback={<div className="h-[400px] flex items-center justify-center text-xs text-osint-muted font-mono">Loading graph...</div>}>
                    <div className="h-[450px]">
                      <GraphVisualization
                        entities={result.data.graph.entities}
                        relations={result.data.graph.relations || []}
                      />
                    </div>
                  </Suspense>
                )}
              </Section>
            )}

            {/* Full Report Download */}
            {result.report && (
              <div className="flex gap-3">
                <button onClick={() => {
                  const blob = new Blob([result.report], { type: 'text/markdown' });
                  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                  a.download = `osint-${target.replace(/[^a-zA-Z0-9]/g, '-')}.md`; a.click();
                }} className="flex-1 py-3 bg-osint-accent/10 border border-osint-accent/30 text-osint-accent font-mono text-sm rounded-lg hover:bg-osint-accent/20 transition text-center">
                  DOWNLOAD REPORT (.md)
                </button>
                <button onClick={() => {
                  const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
                  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                  a.download = `osint-${target.replace(/[^a-zA-Z0-9]/g, '-')}.json`; a.click();
                }} className="flex-1 py-3 bg-osint-cyan/10 border border-osint-cyan/30 text-osint-cyan font-mono text-sm rounded-lg hover:bg-osint-cyan/20 transition text-center">
                  EXPORT RAW DATA (.json)
                </button>
              </div>
            )}

            {/* Raw JSON Toggle */}
            <details>
              <summary className="text-[10px] text-osint-muted font-mono cursor-pointer hover:text-osint-text">▸ RAW JSON OUTPUT</summary>
              <pre className="mt-2 p-4 bg-osint-card border border-osint-border rounded-lg text-[10px] text-osint-accent/70 overflow-x-auto max-h-80 font-mono">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
