import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api/client';

export default function OsintGithubPage() {
  const [searchParams] = useSearchParams();
  const [target, setTarget] = useState(searchParams.get('q') || '');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!target.trim()) return;
    setLoading(true); setError(null); setData(null);
    try {
      const res = await apiFetch('/osint/github', { method: 'POST', body: JSON.stringify({ target: target.trim() }) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setData(json.data);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const d = data;
  return (
    <div className="flex-1 overflow-y-auto bg-osint-bg p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="bg-osint-panel border border-osint-border rounded-xl p-5">
          <h2 className="text-xs font-bold text-osint-muted tracking-[.15em] uppercase mb-3">GITHUB / CODE REPOSITORY RECON</h2>
          <p className="text-xs text-osint-muted mb-3">Search for leaked secrets, exposed credentials, and code mentions</p>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-osint-accent font-mono text-sm">$</div>
              <input type="text" value={target} onChange={e => setTarget(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !loading) run(); }}
                placeholder="Organization or domain (e.g. github.com)..." disabled={loading}
                className="w-full pl-7 pr-4 py-3 bg-osint-input border border-osint-border rounded-lg text-sm font-mono text-osint-text placeholder-osint-muted/50 focus:outline-none focus:border-osint-accent/40 transition disabled:opacity-50" />
            </div>
            <button onClick={run} disabled={loading || !target.trim()}
              className="px-6 py-3 bg-osint-accent/10 border border-osint-accent/30 text-osint-accent font-mono text-sm rounded-lg hover:bg-osint-accent/20 disabled:opacity-30 transition">
              {loading ? 'SCANNING...' : 'SCAN REPOS'}
            </button>
          </div>
        </div>

        {loading && <div className="bg-osint-panel border border-osint-border rounded-xl p-8 text-center"><div className="spinner w-6 h-6 mx-auto mb-3" /><p className="text-xs text-osint-accent font-mono">Searching GitHub repositories & code...</p><p className="text-[10px] text-osint-muted mt-1">Rate limited — may take 10-20s</p></div>}
        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400 font-mono">ERROR: {error}</div>}

        {!loading && d && (
          <div className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              {[['Repos', d.stats?.repos], ['Code Hits', d.stats?.codeHits], ['Gists', d.stats?.gists]].map(([l, v], i) => (
                <div key={i} className="bg-osint-panel border border-osint-border rounded-lg p-3 text-center">
                  <div className={`text-xl font-bold font-mono ${Number(v) > 0 ? 'text-osint-accent' : 'text-osint-muted'}`}>{v}</div>
                  <div className="text-[10px] text-osint-muted">{l}</div>
                </div>
              ))}
            </div>

            {/* Code Matches (potential leaks) */}
            {d.codeMatches?.length > 0 && (
              <div className="bg-osint-panel border border-amber-500/30 rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-amber-500/10"><span className="text-xs font-semibold text-amber-400">CODE MATCHES — POTENTIAL SECRETS ({d.codeMatches.length})</span></div>
                <div className="p-4 space-y-2">
                  {d.codeMatches.map((m: any, i: number) => (
                    <div key={i} className="px-3 py-2 bg-osint-bg rounded border border-osint-border text-xs font-mono">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-osint-cyan">{m.repo}</span>
                        <span className="text-osint-muted">/</span>
                        <span className="text-osint-text/80">{m.file}</span>
                        {m.secretType && <span className="ml-auto px-2 py-0.5 bg-red-500/10 text-red-400 rounded text-[9px]">{m.secretType}</span>}
                      </div>
                      <div className="text-osint-muted truncate">{m.matchLine}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Repositories */}
            {d.repos?.length > 0 && (
              <div className="bg-osint-panel border border-osint-border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-osint-card/50"><span className="text-xs font-semibold text-osint-accent">REPOSITORIES ({d.repos.length})</span></div>
                <div className="p-4 space-y-2">
                  {d.repos.map((r: any, i: number) => (
                    <div key={i} className="px-3 py-2 bg-osint-bg rounded border border-osint-border text-xs font-mono">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-osint-accent">{r.name}</span>
                        <div className="flex gap-3 text-osint-muted">
                          <span>★ {r.stars}</span>
                          <span>🍴 {r.forks}</span>
                          {r.language && <span className="text-osint-cyan">{r.language}</span>}
                        </div>
                      </div>
                      {r.description && <p className="text-osint-text/60 truncate">{r.description}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {d.repos?.length === 0 && d.codeMatches?.length === 0 && (
              <div className="bg-osint-accent/5 border border-osint-accent/20 rounded-xl p-6 text-center">
                <p className="text-sm text-osint-accent font-mono">No public code exposures found for this target</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
