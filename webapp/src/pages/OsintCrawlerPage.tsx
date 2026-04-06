import { useState } from 'react';
import { apiFetch } from '../api/client';

export default function OsintCrawlerPage() {
  const [target, setTarget] = useState('');
  const [maxPages, setMaxPages] = useState(15);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!target.trim()) return;
    setLoading(true); setError(null); setData(null);
    try {
      const res = await apiFetch('/osint/crawl', { method: 'POST', body: JSON.stringify({ target: target.trim(), maxPages }) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setData(json.data);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const s = data?.stats;
  return (
    <div className="flex-1 overflow-y-auto bg-osint-bg p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="bg-osint-panel border border-osint-border rounded-xl p-5">
          <h2 className="text-xs font-bold text-osint-muted tracking-[.15em] uppercase mb-3">DEEP SITE CRAWLER</h2>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-osint-accent font-mono text-sm">$</div>
              <input type="text" value={target} onChange={e => setTarget(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !loading) run(); }}
                placeholder="https://example.com" disabled={loading}
                className="w-full pl-7 pr-4 py-3 bg-osint-input border border-osint-border rounded-lg text-sm font-mono text-osint-text placeholder-osint-muted/50 focus:outline-none focus:border-osint-accent/40 transition disabled:opacity-50" />
            </div>
            <input type="number" value={maxPages} onChange={e => setMaxPages(+e.target.value)} min={1} max={50}
              className="w-20 px-3 py-3 bg-osint-input border border-osint-border rounded-lg text-sm font-mono text-osint-text text-center focus:outline-none focus:border-osint-accent/40" />
            <button onClick={run} disabled={loading || !target.trim()}
              className="px-6 py-3 bg-osint-accent/10 border border-osint-accent/30 text-osint-accent font-mono text-sm rounded-lg hover:bg-osint-accent/20 disabled:opacity-30 transition">
              {loading ? 'CRAWLING...' : 'CRAWL'}
            </button>
          </div>
        </div>

        {loading && <div className="bg-osint-panel border border-osint-accent/20 rounded-xl p-8 text-center"><div className="spinner w-6 h-6 mx-auto mb-3" /><p className="text-xs text-osint-accent font-mono">Crawling site (max {maxPages} pages)...</p></div>}
        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400 font-mono">ERROR: {error}</div>}

        {!loading && data && (
          <div className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-5 gap-3">
              {[['Pages', s?.pagesVisited], ['Links', s?.totalLinks], ['Forms', s?.totalForms], ['Emails', s?.totalEmails], ['Duration', `${((s?.durationMs || 0) / 1000).toFixed(1)}s`]].map(([l, v]) => (
                <div key={l as string} className="bg-osint-panel border border-osint-border rounded-lg p-3 text-center">
                  <div className="text-xl font-bold font-mono text-osint-accent">{v}</div>
                  <div className="text-[10px] text-osint-muted">{l}</div>
                </div>
              ))}
            </div>

            {/* Emails Found */}
            {data.allEmails?.length > 0 && (
              <div className="bg-osint-panel border border-osint-accent/20 rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-osint-card/50"><span className="text-xs font-semibold text-osint-accent">EMAILS FOUND ({data.allEmails.length})</span></div>
                <div className="p-4 flex flex-wrap gap-2">
                  {data.allEmails.map((e: string, i: number) => (
                    <span key={i} className="px-3 py-1 bg-osint-accent/10 border border-osint-accent/20 rounded-full text-xs font-mono text-osint-accent">{e}</span>
                  ))}
                </div>
              </div>
            )}

            {/* External Domains */}
            {data.externalDomains?.length > 0 && (
              <div className="bg-osint-panel border border-osint-border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-osint-card/50"><span className="text-xs font-semibold text-osint-cyan">EXTERNAL DOMAINS ({data.externalDomains.length})</span></div>
                <div className="p-4 flex flex-wrap gap-1">
                  {data.externalDomains.slice(0, 40).map((d: string, i: number) => (
                    <span key={i} className="px-2 py-1 bg-osint-bg border border-osint-border rounded text-[10px] font-mono text-osint-text/60">{d}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Pages */}
            <div className="bg-osint-panel border border-osint-border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 bg-osint-card/50"><span className="text-xs font-semibold text-osint-accent">CRAWLED PAGES ({data.pages?.length})</span></div>
              <div className="p-4 space-y-2">
                {data.pages?.map((p: any, i: number) => (
                  <div key={i} className="px-3 py-2 bg-osint-bg rounded border border-osint-border">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-osint-accent truncate max-w-lg">{p.url}</span>
                      <div className="flex gap-3 text-[10px] font-mono text-osint-muted">
                        <span>{p.status}</span>
                        <span>{p.links?.length || 0} links</span>
                        <span>{p.forms?.length || 0} forms</span>
                        <span>{Math.round(p.size / 1024)}KB</span>
                      </div>
                    </div>
                    {p.title && <div className="text-xs text-osint-text/60 mt-1">{p.title}</div>}
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
