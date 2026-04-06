import { useState } from 'react';
import { apiFetch } from '../api/client';

export default function OsintBreachPage() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'password' | 'email'>('password');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!input.trim()) return;
    setLoading(true); setError(null); setData(null);
    try {
      let res;
      if (mode === 'password') {
        res = await apiFetch('/osint/breach/password', { method: 'POST', body: JSON.stringify({ password: input.trim() }) });
      } else {
        res = await apiFetch('/osint/breach', { method: 'POST', body: JSON.stringify({ target: input.trim() }) });
      }
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setData({ mode, ...json.data });
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const strengthColor = (score: string) => {
    const m: Record<string, string> = { very_weak: 'text-red-400', weak: 'text-orange-400', fair: 'text-amber-400', strong: 'text-osint-accent', very_strong: 'text-cyan-400' };
    return m[score] || 'text-osint-muted';
  };

  return (
    <div className="flex-1 overflow-y-auto bg-osint-bg p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="bg-osint-panel border border-osint-border rounded-xl p-5">
          <h2 className="text-xs font-bold text-osint-muted tracking-[.15em] uppercase mb-3">BREACH & LEAK CHECK</h2>
          <div className="flex gap-2 mb-3">
            <button onClick={() => setMode('password')} className={`px-3 py-1.5 text-xs font-mono rounded-md border transition ${mode === 'password' ? 'bg-osint-accent/10 border-osint-accent/30 text-osint-accent' : 'border-osint-border text-osint-muted'}`}>Password Check</button>
            <button onClick={() => setMode('email')} className={`px-3 py-1.5 text-xs font-mono rounded-md border transition ${mode === 'email' ? 'bg-osint-accent/10 border-osint-accent/30 text-osint-accent' : 'border-osint-border text-osint-muted'}`}>Email Breach</button>
          </div>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-osint-accent font-mono text-sm">$</div>
              <input type={mode === 'password' ? 'password' : 'text'} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !loading) run(); }}
                placeholder={mode === 'password' ? 'Enter password to check...' : 'Enter email address...'} disabled={loading}
                className="w-full pl-7 pr-4 py-3 bg-osint-input border border-osint-border rounded-lg text-sm font-mono text-osint-text placeholder-osint-muted/50 focus:outline-none focus:border-osint-accent/40 transition disabled:opacity-50" />
            </div>
            <button onClick={run} disabled={loading || !input.trim()}
              className="px-6 py-3 bg-osint-accent/10 border border-osint-accent/30 text-osint-accent font-mono text-sm rounded-lg hover:bg-osint-accent/20 disabled:opacity-30 transition">
              {loading ? 'CHECKING...' : 'CHECK'}
            </button>
          </div>
          <p className="text-[10px] text-osint-muted mt-2 font-mono">
            {mode === 'password' ? '🔒 Uses k-anonymity — only first 5 chars of SHA-1 hash are sent' : 'Checks against known breach databases'}
          </p>
        </div>

        {loading && <div className="bg-osint-panel border border-osint-border rounded-xl p-8 text-center"><div className="spinner w-6 h-6 mx-auto mb-3" /><p className="text-xs text-osint-accent font-mono">Checking breach databases...</p></div>}
        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400 font-mono">ERROR: {error}</div>}

        {!loading && data && (
          <div className="space-y-4">
            {/* Password Results */}
            {data.mode === 'password' && (
              <>
                {/* Leak Status */}
                <div className={`p-6 rounded-xl border text-center ${data.leaked ? 'bg-red-500/10 border-red-500/30' : 'bg-osint-accent/5 border-osint-accent/20'}`}>
                  <div className="text-4xl mb-2">{data.leaked ? '⚠' : '✓'}</div>
                  <p className={`text-lg font-mono font-bold ${data.leaked ? 'text-red-400' : 'text-osint-accent'}`}>
                    {data.leaked ? `LEAKED — found in ${data.leakCount?.toLocaleString()} breaches` : 'NOT FOUND in known breaches'}
                  </p>
                </div>

                {/* Strength Analysis */}
                <div className="bg-osint-panel border border-osint-border rounded-lg overflow-hidden">
                  <div className="px-4 py-2.5 bg-osint-card/50"><span className="text-xs font-semibold text-osint-accent">PASSWORD STRENGTH</span></div>
                  <div className="p-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <table className="w-full text-xs font-mono"><tbody>
                          <tr className="border-b border-osint-border/50"><td className="py-1.5 text-osint-cyan">Score</td><td className={`py-1.5 font-bold ${strengthColor(data.score)}`}>{data.score?.replace('_', ' ').toUpperCase()}</td></tr>
                          <tr className="border-b border-osint-border/50"><td className="py-1.5 text-osint-cyan">Entropy</td><td className="py-1.5 text-osint-text/80">{data.entropy} bits</td></tr>
                          <tr className="border-b border-osint-border/50"><td className="py-1.5 text-osint-cyan">Length</td><td className="py-1.5 text-osint-text/80">{data.length} chars</td></tr>
                          <tr><td className="py-1.5 text-osint-cyan">Time to crack</td><td className="py-1.5 text-osint-text/80">{data.timeToCrack}</td></tr>
                        </tbody></table>
                      </div>
                      <div className="space-y-2">
                        {[['Uppercase', data.hasUpper], ['Lowercase', data.hasLower], ['Digits', data.hasDigit], ['Special', data.hasSpecial]].map(([l, v]) => (
                          <div key={l as string} className="flex items-center gap-2 text-xs font-mono">
                            <span className={v ? 'text-osint-accent' : 'text-red-400'}>{v ? '✓' : '✗'}</span>
                            <span className="text-osint-text/70">{l}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Email Breach Results */}
            {data.mode === 'email' && data.breaches?.length > 0 && (
              <div className="bg-osint-panel border border-red-500/30 rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-red-500/10"><span className="text-xs font-semibold text-red-400">KNOWN BREACHES ({data.breaches.length})</span></div>
                <div className="p-4 space-y-3">
                  {data.breaches.map((b: any, i: number) => (
                    <div key={i} className="px-4 py-3 bg-osint-bg rounded-lg border border-osint-border">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-mono text-red-300 font-bold">{b.name}</span>
                        <span className="text-[10px] text-osint-muted">{b.breachDate}</span>
                      </div>
                      {b.pwnCount && <div className="text-xs text-osint-muted">{b.pwnCount.toLocaleString()} accounts compromised</div>}
                      {b.dataClasses && <div className="text-xs text-osint-text/60 mt-1">Data: {b.dataClasses.join(', ')}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
