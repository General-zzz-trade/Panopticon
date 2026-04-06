import { useState } from 'react';
import { apiFetch } from '../api/client';

export default function OsintBatchPage() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const targets = input.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (targets.length === 0) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await apiFetch('/osint/batch', {
        method: 'POST',
        body: JSON.stringify({ targets, concurrency: 2 }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setResult(json.data);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const r = result;
  return (
    <div className="flex-1 overflow-y-auto bg-osint-bg p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="bg-osint-panel border border-osint-border rounded-xl p-5">
          <h2 className="text-xs font-bold text-osint-muted tracking-[.15em] uppercase mb-3">BATCH INVESTIGATION</h2>
          <p className="text-xs text-osint-muted mb-3">Enter one target per line — domains, IPs, emails, or usernames</p>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={"example.com\ngithub.com\n8.8.8.8\nuser@example.com"}
            rows={6}
            disabled={loading}
            className="w-full px-4 py-3 bg-osint-input border border-osint-border rounded-lg text-sm font-mono text-osint-text placeholder-osint-muted/50 focus:outline-none focus:border-osint-accent/40 transition disabled:opacity-50"
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-[10px] font-mono text-osint-muted">
              {input.trim().split('\n').filter(l => l.trim()).length} targets
            </span>
            <button onClick={run} disabled={loading || !input.trim()}
              className="px-6 py-2.5 bg-osint-accent/10 border border-osint-accent/30 text-osint-accent font-mono text-sm rounded-lg hover:bg-osint-accent/20 disabled:opacity-30 transition">
              {loading ? 'RUNNING...' : 'RUN BATCH'}
            </button>
          </div>
        </div>

        {loading && <div className="bg-osint-panel border border-osint-accent/20 rounded-xl p-8 text-center"><div className="spinner w-6 h-6 mx-auto mb-3" /><p className="text-xs text-osint-accent font-mono">Processing batch... this may take several minutes</p></div>}
        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400 font-mono">ERROR: {error}</div>}

        {!loading && r && (
          <div className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3">
              {[['Total', r.stats?.total], ['Succeeded', r.stats?.succeeded], ['Failed', r.stats?.failed], ['Duration', `${((r.stats?.totalDurationMs || 0) / 1000).toFixed(0)}s`]].map(([l, v], i) => (
                <div key={i} className="bg-osint-panel border border-osint-border rounded-lg p-3 text-center">
                  <div className={`text-xl font-bold font-mono ${i === 2 && Number(v) > 0 ? 'text-red-400' : 'text-osint-accent'}`}>{v}</div>
                  <div className="text-[10px] text-osint-muted">{l}</div>
                </div>
              ))}
            </div>

            {/* Results */}
            <div className="bg-osint-panel border border-osint-border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 bg-osint-card/50"><span className="text-xs font-semibold text-osint-accent">RESULTS</span></div>
              <div className="p-4 space-y-2">
                {r.results?.map((item: any, i: number) => (
                  <div key={i} className={`px-4 py-3 rounded-lg border ${item.status === 'success' ? 'border-osint-border bg-osint-bg' : 'border-red-500/20 bg-red-500/5'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-mono ${item.status === 'success' ? 'text-osint-accent' : 'text-red-400'}`}>
                          {item.status === 'success' ? '✓' : '✗'}
                        </span>
                        <span className="text-sm font-mono text-osint-text">{item.target}</span>
                      </div>
                      <span className="text-[10px] font-mono text-osint-muted">{(item.durationMs / 1000).toFixed(1)}s</span>
                    </div>
                    {item.status === 'success' && item.data && (
                      <div className="flex gap-3 text-[10px] font-mono text-osint-muted mt-1">
                        <span>Risk: <span className={item.data.riskLevel === 'high' || item.data.riskLevel === 'critical' ? 'text-red-400' : 'text-osint-accent'}>{item.data.riskLevel}</span></span>
                        <span>Entities: {item.data.entityCount}</span>
                        <span>Relations: {item.data.relationCount}</span>
                      </div>
                    )}
                    {item.error && <p className="text-xs text-red-400 font-mono mt-1">{item.error}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
