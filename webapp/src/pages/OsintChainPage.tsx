import { useState, useEffect } from 'react';
import { apiFetch } from '../api/client';

export default function OsintChainPage() {
  const [chains, setChains] = useState<Record<string, any>>({});
  const [selectedChain, setSelectedChain] = useState<string>('');
  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/osint/chains').then(r => r.json()).then(d => {
      if (d.success) { setChains(d.data); setSelectedChain(Object.keys(d.data)[0] || ''); }
    }).catch(() => {});
  }, []);

  const run = async () => {
    if (!target.trim() || !selectedChain) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await apiFetch('/osint/chain/execute', { method: 'POST', body: JSON.stringify({ chain: selectedChain, target: target.trim() }) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setResult(json.data);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const stepIcon = (status: string) => ({ done: '✓', failed: '✗', running: '◉', pending: '○', skipped: '—' }[status] || '○');
  const stepColor = (status: string) => ({ done: 'text-osint-accent', failed: 'text-red-400', running: 'text-amber-400', pending: 'text-osint-muted' }[status] || 'text-osint-muted');

  return (
    <div className="flex-1 overflow-y-auto bg-osint-bg p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="bg-osint-panel border border-osint-border rounded-xl p-5">
          <h2 className="text-xs font-bold text-osint-muted tracking-[.15em] uppercase mb-3">INVESTIGATION CHAIN</h2>

          {/* Chain Selector */}
          <div className="grid grid-cols-1 gap-2 mb-4">
            {Object.entries(chains).map(([id, chain]: [string, any]) => (
              <button key={id} onClick={() => setSelectedChain(id)}
                className={`text-left px-4 py-3 rounded-lg border transition ${selectedChain === id ? 'bg-osint-accent/10 border-osint-accent/30' : 'bg-osint-bg border-osint-border hover:border-osint-accent/20'}`}>
                <div className="text-sm font-mono text-osint-text font-semibold">{chain.name}</div>
                <div className="text-xs text-osint-muted mt-0.5">{chain.description}</div>
                <div className="flex gap-1 mt-2">
                  {chain.steps?.map((s: any, i: number) => (
                    <span key={i} className="px-2 py-0.5 text-[9px] font-mono bg-osint-card border border-osint-border rounded text-osint-muted">{s.type}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>

          <div className="flex gap-3">
            <div className="flex-1 relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-osint-accent font-mono text-sm">$</div>
              <input type="text" value={target} onChange={e => setTarget(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !loading) run(); }}
                placeholder="Target for investigation chain..." disabled={loading}
                className="w-full pl-7 pr-4 py-3 bg-osint-input border border-osint-border rounded-lg text-sm font-mono text-osint-text placeholder-osint-muted/50 focus:outline-none focus:border-osint-accent/40 transition disabled:opacity-50" />
            </div>
            <button onClick={run} disabled={loading || !target.trim() || !selectedChain}
              className="px-6 py-3 bg-osint-accent/10 border border-osint-accent/30 text-osint-accent font-mono text-sm rounded-lg hover:bg-osint-accent/20 disabled:opacity-30 transition">
              {loading ? 'EXECUTING...' : 'LAUNCH CHAIN'}
            </button>
          </div>
        </div>

        {loading && <div className="bg-osint-panel border border-osint-accent/20 rounded-xl p-8 text-center glow-green"><div className="spinner w-8 h-8 mx-auto mb-4" /><p className="text-sm text-osint-accent font-mono">Executing chain — this may take several minutes...</p></div>}
        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400 font-mono">ERROR: {error}</div>}

        {!loading && result && (
          <div className="space-y-4">
            {/* Status Header */}
            <div className="bg-osint-panel border border-osint-border rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`text-lg ${result.status === 'completed' ? 'text-osint-accent' : result.status === 'failed' ? 'text-red-400' : 'text-amber-400'}`}>
                  {result.status === 'completed' ? '✓' : result.status === 'failed' ? '✗' : '◉'}
                </span>
                <div>
                  <span className="text-sm font-mono text-osint-text">{result.name}</span>
                  <span className={`ml-2 px-2 py-0.5 text-[10px] font-mono rounded ${result.status === 'completed' ? 'bg-osint-accent/10 text-osint-accent' : result.status === 'failed' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                    {result.status}
                  </span>
                </div>
              </div>
              <span className="text-xs font-mono text-osint-muted">{(result.totalDurationMs / 1000).toFixed(1)}s</span>
            </div>

            {/* Steps */}
            <div className="bg-osint-panel border border-osint-border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 bg-osint-card/50"><span className="text-xs font-semibold text-osint-accent">STEPS ({result.steps?.length})</span></div>
              <div className="p-4 space-y-2">
                {result.steps?.map((step: any, i: number) => (
                  <div key={i} className={`px-4 py-3 rounded-lg border ${step.status === 'failed' ? 'border-red-500/30 bg-red-500/5' : 'border-osint-border bg-osint-bg'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`font-mono ${stepColor(step.status)}`}>{stepIcon(step.status)}</span>
                        <span className="text-sm font-mono text-osint-text">{step.id}</span>
                        <span className="px-2 py-0.5 text-[9px] font-mono bg-osint-card border border-osint-border rounded text-osint-muted">{step.type}</span>
                      </div>
                      <span className="text-[10px] font-mono text-osint-muted">{step.durationMs ? `${(step.durationMs / 1000).toFixed(1)}s` : ''}</span>
                    </div>
                    {step.error && <div className="text-xs text-red-400 font-mono mt-1">Error: {step.error}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Raw Data */}
            <details>
              <summary className="text-[10px] text-osint-muted font-mono cursor-pointer hover:text-osint-text">▸ RAW CHAIN OUTPUT</summary>
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
