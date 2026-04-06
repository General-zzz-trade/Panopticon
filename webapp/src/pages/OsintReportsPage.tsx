import { useState, useEffect, useCallback } from 'react';

interface OsintReport {
  id: string;
  target: string;
  type: string;
  riskLevel: string;
  timestamp: string;
  durationMs: number;
  markdown: string;
  raw?: any;
}

function RiskBadge({ level }: { level: string }) {
  const cfg: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-400 border-red-500/30',
    high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    low: 'bg-green-500/20 text-osint-accent border-green-500/30',
  };
  return (
    <span className={`px-3 py-1 rounded border text-xs font-mono font-bold uppercase tracking-wider ${cfg[level] || 'bg-gray-500/20 text-gray-400'}`}>
      {level}
    </span>
  );
}

function download(filename: string, content: string, mime = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const STORAGE_KEY = 'osint-reports';

function loadReports(): OsintReport[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveReports(reports: OsintReport[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

export default function OsintReportsPage() {
  const [reports, setReports] = useState<OsintReport[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => { setReports(loadReports()); }, []);

  const deleteReport = useCallback((id: string) => {
    const next = reports.filter(r => r.id !== id);
    saveReports(next);
    setReports(next);
    if (expanded === id) setExpanded(null);
  }, [reports, expanded]);

  const clearAll = useCallback(() => {
    saveReports([]);
    setReports([]);
    setConfirmClear(false);
    setExpanded(null);
  }, []);

  const exportAll = useCallback(() => {
    if (!reports.length) return;
    const combined = reports.map(r =>
      `# ${r.target} (${r.type})\n> Risk: ${r.riskLevel} | ${new Date(r.timestamp).toLocaleString()} | Duration: ${fmtDuration(r.durationMs)}\n\n${r.markdown}\n\n---\n`
    ).join('\n');
    download(`osint-reports-${Date.now()}.md`, combined);
  }, [reports]);

  return (
    <div className="min-h-screen bg-osint-bg text-osint-text p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-mono tracking-tight text-osint-accent">Investigation Reports</h1>
            <p className="text-osint-muted text-sm mt-1">{reports.length} report{reports.length !== 1 ? 's' : ''} on file</p>
          </div>
          {reports.length > 0 && (
            <div className="flex gap-2">
              <button onClick={exportAll} className="px-4 py-2 rounded border border-osint-border bg-osint-panel text-osint-accent text-xs font-mono hover:bg-osint-card transition">Export All .md</button>
              {confirmClear ? (
                <div className="flex gap-1">
                  <button onClick={clearAll} className="px-3 py-2 rounded bg-red-600 text-white text-xs font-mono hover:bg-red-500 transition">Confirm</button>
                  <button onClick={() => setConfirmClear(false)} className="px-3 py-2 rounded border border-osint-border text-osint-muted text-xs font-mono hover:text-osint-text transition">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmClear(true)} className="px-4 py-2 rounded border border-red-500/30 text-red-400 text-xs font-mono hover:bg-red-500/10 transition">Clear All</button>
              )}
            </div>
          )}
        </div>

        {/* Empty state */}
        {reports.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-5xl mb-4 opacity-30">&#128269;</div>
            <p className="text-osint-muted font-mono text-sm">No investigations yet — run your first scan</p>
          </div>
        )}

        {/* Report cards */}
        {reports.map(r => (
          <div key={r.id} className="rounded-lg border border-osint-border bg-osint-panel overflow-hidden">
            <button onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-osint-card/50 transition">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-osint-cyan font-mono text-sm truncate">{r.target}</span>
                <span className="text-osint-muted text-xs font-mono shrink-0">{r.type}</span>
                <RiskBadge level={r.riskLevel} />
              </div>
              <div className="flex items-center gap-4 shrink-0 text-xs text-osint-muted font-mono">
                <span>{fmtDuration(r.durationMs)}</span>
                <span>{new Date(r.timestamp).toLocaleDateString()}</span>
                <span className={`transition-transform ${expanded === r.id ? 'rotate-180' : ''}`}>&#9660;</span>
              </div>
            </button>

            {expanded === r.id && (
              <div className="border-t border-osint-border">
                <pre className="px-5 py-4 text-xs font-mono text-osint-text whitespace-pre-wrap max-h-96 overflow-y-auto bg-osint-bg/50">{r.markdown}</pre>
                <div className="flex gap-2 px-5 py-3 border-t border-osint-border bg-osint-card/30">
                  <button onClick={() => download(`${r.target.replace(/[^a-zA-Z0-9]/g, '-')}-report.md`, r.markdown)} className="px-3 py-1.5 rounded border border-osint-border text-osint-accent text-xs font-mono hover:bg-osint-panel transition">Download .md</button>
                  <button onClick={() => download(`${r.target.replace(/[^a-zA-Z0-9]/g, '-')}-report.json`, JSON.stringify(r, null, 2), 'application/json')} className="px-3 py-1.5 rounded border border-osint-border text-osint-cyan text-xs font-mono hover:bg-osint-panel transition">Download .json</button>
                  <button onClick={() => deleteReport(r.id)} className="px-3 py-1.5 rounded border border-red-500/30 text-red-400 text-xs font-mono hover:bg-red-500/10 transition ml-auto">Delete</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
