import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api/client';

export default function OsintAsnPage() {
  const [searchParams] = useSearchParams();
  const [target, setTarget] = useState(searchParams.get('q') || '');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'full' | 'reverseip' | 'asn'>('full');

  const run = async () => {
    if (!target.trim()) return;
    setLoading(true); setError(null); setData(null);
    try {
      let res;
      if (mode === 'full') res = await apiFetch('/osint/network-intel', { method: 'POST', body: JSON.stringify({ target: target.trim() }) });
      else if (mode === 'reverseip') res = await apiFetch(`/osint/reverseip/${encodeURIComponent(target.trim())}`);
      else res = await apiFetch(`/osint/asn/${encodeURIComponent(target.trim())}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setData({ mode, ...json });
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const d = data?.data;
  return (
    <div className="flex-1 overflow-y-auto bg-osint-bg p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="bg-osint-panel border border-osint-border rounded-xl p-5">
          <h2 className="text-xs font-bold text-osint-muted tracking-[.15em] uppercase mb-3">ASN / REVERSE IP INTELLIGENCE</h2>
          <div className="flex gap-2 mb-3">
            {[{ id: 'full', l: 'Full Intel' }, { id: 'reverseip', l: 'Reverse IP' }, { id: 'asn', l: 'ASN Lookup' }].map(m => (
              <button key={m.id} onClick={() => setMode(m.id as any)}
                className={`px-3 py-1.5 text-xs font-mono rounded-md border transition ${mode === m.id ? 'bg-osint-accent/10 border-osint-accent/30 text-osint-accent' : 'border-osint-border text-osint-muted hover:text-osint-text'}`}>
                {m.l}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-osint-accent font-mono text-sm">$</div>
              <input type="text" value={target} onChange={e => setTarget(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !loading) run(); }}
                placeholder="IP address (e.g. 8.8.8.8)..." disabled={loading}
                className="w-full pl-7 pr-4 py-3 bg-osint-input border border-osint-border rounded-lg text-sm font-mono text-osint-text placeholder-osint-muted/50 focus:outline-none focus:border-osint-accent/40 transition disabled:opacity-50" />
            </div>
            <button onClick={run} disabled={loading || !target.trim()}
              className="px-6 py-3 bg-osint-accent/10 border border-osint-accent/30 text-osint-accent font-mono text-sm rounded-lg hover:bg-osint-accent/20 disabled:opacity-30 transition">
              {loading ? 'SCANNING...' : 'LOOKUP'}
            </button>
          </div>
        </div>

        {loading && <div className="bg-osint-panel border border-osint-border rounded-xl p-8 text-center"><div className="spinner w-6 h-6 mx-auto mb-3" /><p className="text-xs text-osint-accent font-mono">Querying network intelligence...</p></div>}
        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400 font-mono">ERROR: {error}</div>}

        {!loading && d && (
          <div className="space-y-4">
            {/* ASN Info */}
            {(d.asn || (data.mode === 'asn')) && (() => {
              const a = d.asn || d;
              return a.asn ? (
                <div className="bg-osint-panel border border-osint-border rounded-lg overflow-hidden">
                  <div className="px-4 py-2.5 bg-osint-card/50"><span className="text-xs font-semibold text-osint-accent">ASN INFORMATION</span></div>
                  <div className="p-4"><table className="w-full text-xs font-mono"><tbody>
                    {[['ASN', a.asn], ['Name', a.name], ['CIDR', a.cidr], ['Country', a.country], ['Registry', a.registry], ['Description', a.description]].filter(([,v]) => v).map(([k,v], i) => (
                      <tr key={i} className="border-b border-osint-border/50"><td className="py-1.5 px-3 text-osint-cyan w-32">{k}</td><td className="py-1.5 px-3 text-osint-text/80">{v}</td></tr>
                    ))}
                  </tbody></table></div>
                </div>
              ) : null;
            })()}

            {/* Reverse IP */}
            {(d.reverseIp || data.mode === 'reverseip') && (() => {
              const r = d.reverseIp || d;
              return r.domains?.length > 0 ? (
                <div className="bg-osint-panel border border-osint-border rounded-lg overflow-hidden">
                  <div className="px-4 py-2.5 bg-osint-card/50"><span className="text-xs font-semibold text-osint-cyan">CO-HOSTED DOMAINS ({r.domains.length})</span></div>
                  <div className="p-4">
                    <div className="grid grid-cols-2 gap-1">
                      {r.domains.map((dom: string, i: number) => (
                        <div key={i} className="px-3 py-1.5 text-xs font-mono text-osint-accent bg-osint-bg rounded border border-osint-border">{dom}</div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null;
            })()}

            {/* Prefixes */}
            {d.prefixes?.prefixes?.length > 0 && (
              <div className="bg-osint-panel border border-osint-border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-osint-card/50"><span className="text-xs font-semibold text-osint-accent">ANNOUNCED PREFIXES ({d.prefixes.prefixes.length})</span></div>
                <div className="p-4">
                  <div className="grid grid-cols-3 gap-1">
                    {d.prefixes.prefixes.slice(0, 30).map((p: any, i: number) => (
                      <div key={i} className="px-3 py-1.5 text-xs font-mono text-osint-text/70 bg-osint-bg rounded border border-osint-border">
                        {p.prefix} {p.name ? <span className="text-osint-muted ml-1">{p.name}</span> : ''}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* IP Block */}
            {d.ipBlock && (
              <div className="bg-osint-panel border border-osint-border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-osint-card/50"><span className="text-xs font-semibold text-osint-accent">IP BLOCK INFO</span></div>
                <div className="p-4"><table className="w-full text-xs font-mono"><tbody>
                  {[['CIDR', d.ipBlock.cidr], ['Net Name', d.ipBlock.netname], ['Description', d.ipBlock.description], ['Country', d.ipBlock.country], ['Abuse Contact', d.ipBlock.abuse]].filter(([,v]) => v).map(([k,v], i) => (
                    <tr key={i} className="border-b border-osint-border/50"><td className="py-1.5 px-3 text-osint-cyan w-32">{k}</td><td className="py-1.5 px-3 text-osint-text/80">{v}</td></tr>
                  ))}
                </tbody></table></div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
