import { useState, useEffect } from 'react';
import { apiFetch } from '../api/client';

export default function OsintMonitorPage() {
  const [monitors, setMonitors] = useState<any[]>([]);
  const [target, setTarget] = useState('');
  const [checks, setChecks] = useState<string[]>(['subdomains', 'ports', 'uptime', 'ssl_expiry']);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<any>(null);

  const allChecks = ['subdomains', 'ports', 'dns', 'tech_stack', 'ssl_expiry', 'uptime', 'content_change', 'new_threats'];

  const refresh = () => {
    apiFetch('/osint/monitors').then(r => r.json()).then(d => { if (d.success) setMonitors(d.data || []); }).catch(() => {});
  };

  useEffect(() => { refresh(); }, []);

  const addMonitor = async () => {
    if (!target.trim()) return;
    setLoading(true);
    try {
      await apiFetch('/osint/monitors', { method: 'POST', body: JSON.stringify({ target: target.trim(), checks }) });
      setTarget('');
      refresh();
    } catch {} finally { setLoading(false); }
  };

  const runCheck = async (id: string) => {
    setRunningId(id); setRunResult(null);
    try {
      const res = await apiFetch(`/osint/monitors/${id}/run`, { method: 'POST' });
      const json = await res.json();
      setRunResult(json.data);
      refresh();
    } catch {} finally { setRunningId(null); }
  };

  const remove = async (id: string) => {
    await apiFetch(`/osint/monitors/${id}`, { method: 'DELETE' });
    refresh();
  };

  const sevColor = (s: string) => ({ critical: 'text-red-400 bg-red-500/10', warning: 'text-amber-400 bg-amber-500/10', info: 'text-osint-cyan bg-osint-cyan/10' }[s] || 'text-osint-muted');

  return (
    <div className="flex-1 overflow-y-auto bg-osint-bg p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Add Monitor */}
        <div className="bg-osint-panel border border-osint-border rounded-xl p-5">
          <h2 className="text-xs font-bold text-osint-muted tracking-[.15em] uppercase mb-3">CHANGE MONITOR</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {allChecks.map(c => (
              <button key={c} onClick={() => setChecks(cs => cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c])}
                className={`px-2.5 py-1 text-[10px] font-mono rounded border transition ${checks.includes(c) ? 'bg-osint-accent/10 border-osint-accent/30 text-osint-accent' : 'border-osint-border text-osint-muted'}`}>
                {c}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-osint-accent font-mono text-sm">$</div>
              <input type="text" value={target} onChange={e => setTarget(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addMonitor(); }}
                placeholder="Domain or IP to monitor..."
                className="w-full pl-7 pr-4 py-3 bg-osint-input border border-osint-border rounded-lg text-sm font-mono text-osint-text placeholder-osint-muted/50 focus:outline-none focus:border-osint-accent/40 transition" />
            </div>
            <button onClick={addMonitor} disabled={loading || !target.trim()}
              className="px-6 py-3 bg-osint-accent/10 border border-osint-accent/30 text-osint-accent font-mono text-sm rounded-lg hover:bg-osint-accent/20 disabled:opacity-30 transition">
              ADD MONITOR
            </button>
          </div>
        </div>

        {/* Monitor List */}
        {monitors.length === 0 ? (
          <div className="text-center py-12 text-osint-muted">
            <div className="text-3xl mb-3">📡</div>
            <p className="text-sm font-mono">No monitors configured — add a target above</p>
          </div>
        ) : (
          <div className="space-y-3">
            {monitors.map(m => (
              <div key={m.id} className="bg-osint-panel border border-osint-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${m.enabled ? 'bg-osint-accent pulse-dot' : 'bg-osint-muted'}`} />
                    <span className="text-sm font-mono text-osint-accent font-bold">{m.target}</span>
                    <span className="text-[10px] font-mono text-osint-muted">{m.type}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => runCheck(m.id)} disabled={runningId === m.id}
                      className="px-3 py-1 text-[10px] font-mono bg-osint-accent/10 border border-osint-accent/20 text-osint-accent rounded hover:bg-osint-accent/20 disabled:opacity-50 transition">
                      {runningId === m.id ? 'RUNNING...' : 'RUN NOW'}
                    </button>
                    <button onClick={() => remove(m.id)}
                      className="px-3 py-1 text-[10px] font-mono bg-red-500/10 border border-red-500/20 text-red-400 rounded hover:bg-red-500/20 transition">
                      REMOVE
                    </button>
                  </div>
                </div>
                <div className="flex gap-1 mb-2">
                  {(m.checks || []).map((c: string) => (
                    <span key={c} className="px-2 py-0.5 text-[9px] font-mono bg-osint-card border border-osint-border rounded text-osint-muted">{c}</span>
                  ))}
                </div>
                {m.lastRun && <div className="text-[10px] text-osint-muted font-mono">Last run: {new Date(m.lastRun).toLocaleString()}</div>}

                {/* Alerts */}
                {m.alerts?.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {m.alerts.slice(-5).map((a: any, i: number) => (
                      <div key={i} className={`px-3 py-1.5 rounded text-[10px] font-mono ${sevColor(a.severity)}`}>
                        [{a.severity}] {a.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Run Result */}
        {runResult && (
          <div className="bg-osint-panel border border-osint-accent/20 rounded-lg p-4">
            <h3 className="text-xs font-semibold text-osint-accent mb-2">LATEST CHECK RESULT — {runResult.target}</h3>
            <div className="text-xs font-mono text-osint-muted mb-2">{runResult.checksRun} checks, {runResult.alerts?.length || 0} alerts, {(runResult.durationMs / 1000).toFixed(1)}s</div>
            {runResult.alerts?.length > 0 ? (
              <div className="space-y-1">
                {runResult.alerts.map((a: any, i: number) => (
                  <div key={i} className={`px-3 py-1.5 rounded text-xs font-mono ${sevColor(a.severity)}`}>
                    [{a.severity}] {a.message}
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-osint-accent font-mono">✓ No changes detected</p>}
          </div>
        )}
      </div>
    </div>
  );
}
