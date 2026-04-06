import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api/client';

export default function OsintThreatPage() {
  const [searchParams] = useSearchParams();
  const [target, setTarget] = useState(searchParams.get('q') || '');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!target.trim()) return;
    setLoading(true); setError(null); setData(null);
    try {
      const res = await apiFetch('/osint/threat', { method: 'POST', body: JSON.stringify({ target: target.trim() }) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setData(json.data);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const riskColor = (score: number) => score >= 70 ? 'text-red-400' : score >= 40 ? 'text-amber-400' : 'text-osint-accent';
  const d = data;

  return (
    <div className="flex-1 overflow-y-auto bg-osint-bg p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="bg-osint-panel border border-osint-border rounded-xl p-5">
          <h2 className="text-xs font-bold text-osint-muted tracking-[.15em] uppercase mb-3">THREAT INTELLIGENCE</h2>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-osint-accent font-mono text-sm">$</div>
              <input type="text" value={target} onChange={e => setTarget(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !loading) run(); }}
                placeholder="Domain or URL to check..." disabled={loading}
                className="w-full pl-7 pr-4 py-3 bg-osint-input border border-osint-border rounded-lg text-sm font-mono text-osint-text placeholder-osint-muted/50 focus:outline-none focus:border-osint-accent/40 transition disabled:opacity-50" />
            </div>
            <button onClick={run} disabled={loading || !target.trim()}
              className="px-6 py-3 bg-red-500/10 border border-red-500/30 text-red-400 font-mono text-sm rounded-lg hover:bg-red-500/20 disabled:opacity-30 transition">
              {loading ? 'CHECKING...' : 'THREAT CHECK'}
            </button>
          </div>
        </div>

        {loading && <div className="bg-osint-panel border border-osint-border rounded-xl p-8 text-center"><div className="spinner w-6 h-6 mx-auto mb-3" /><p className="text-xs text-osint-accent font-mono">Checking threat databases...</p></div>}
        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400 font-mono">ERROR: {error}</div>}

        {!loading && d && (
          <div className="space-y-4">
            {/* Risk Score */}
            <div className="bg-osint-panel border border-osint-border rounded-xl p-6 flex items-center gap-6">
              <div className="text-center">
                <div className={`text-4xl font-bold font-mono ${riskColor(d.riskScore)}`}>{d.riskScore}</div>
                <div className="text-[10px] text-osint-muted tracking-wider mt-1">RISK SCORE</div>
              </div>
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-osint-card rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${d.riskScore >= 70 ? 'bg-red-500' : d.riskScore >= 40 ? 'bg-amber-500' : 'bg-osint-accent'}`}
                    style={{ width: `${d.riskScore}%` }} />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-osint-muted">
                  <span>Malicious: {d.malicious ? '⚠ YES' : '✓ NO'}</span>
                  <span>{d.threats?.length || 0} threats | {d.blacklists?.filter((b: any) => b.listed).length || 0} blacklists | {d.sslIssues?.length || 0} SSL issues</span>
                </div>
              </div>
            </div>

            {/* Threats */}
            {d.threats?.length > 0 && (
              <div className="bg-osint-panel border border-red-500/30 rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-red-500/10"><span className="text-xs font-semibold text-red-400">THREATS DETECTED ({d.threats.length})</span></div>
                <div className="p-4 space-y-2">
                  {d.threats.map((t: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 text-xs font-mono">
                      <span className="text-red-400 mt-0.5">▸</span>
                      <div><span className="text-red-300">[{t.source}]</span> <span className="text-osint-text/80">{t.description}</span></div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Blacklists */}
            {d.blacklists?.length > 0 && (
              <div className="bg-osint-panel border border-osint-border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-osint-card/50"><span className="text-xs font-semibold text-osint-accent">DNSBL BLACKLISTS ({d.blacklists.length})</span></div>
                <div className="p-4">
                  <div className="grid grid-cols-2 gap-2">
                    {d.blacklists.map((b: any, i: number) => (
                      <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono ${b.listed ? 'bg-red-500/10 border border-red-500/20' : 'bg-osint-bg border border-osint-border'}`}>
                        <span className={b.listed ? 'text-red-400' : 'text-osint-accent'}>{b.listed ? '✗' : '✓'}</span>
                        <span className="text-osint-text/80">{b.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* SSL Issues */}
            {d.sslIssues?.length > 0 && (
              <div className="bg-osint-panel border border-amber-500/30 rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-amber-500/10"><span className="text-xs font-semibold text-amber-400">SSL/TLS ISSUES</span></div>
                <div className="p-4 space-y-1">
                  {d.sslIssues.map((s: string, i: number) => (
                    <div key={i} className="text-xs font-mono text-amber-300">⚠ {s}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Suspicious Patterns */}
            {d.suspiciousPatterns?.length > 0 && (
              <div className="bg-osint-panel border border-osint-border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-osint-card/50"><span className="text-xs font-semibold text-osint-amber">SUSPICIOUS PATTERNS</span></div>
                <div className="p-4 space-y-1">
                  {d.suspiciousPatterns.map((p: string, i: number) => (
                    <div key={i} className="text-xs font-mono text-osint-text/70">⚠ {p}</div>
                  ))}
                </div>
              </div>
            )}

            {d.threats?.length === 0 && d.blacklists?.filter((b: any) => b.listed).length === 0 && d.sslIssues?.length === 0 && (
              <div className="bg-osint-accent/5 border border-osint-accent/20 rounded-xl p-6 text-center">
                <div className="text-3xl mb-2">✓</div>
                <p className="text-sm text-osint-accent font-mono">No threats detected — target appears clean</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
