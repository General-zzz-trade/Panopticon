import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, API } from '../api/client';

/* ── Types ────────────────────────────────────────────────── */

interface LogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  runId?: string;
  extra?: Record<string, unknown>;
}

/* ── Constants ────────────────────────────────────────────── */

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;

const LEVEL_COLORS: Record<string, { badge: string; row: string }> = {
  trace: {
    badge: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
    row: '',
  },
  debug: {
    badge: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    row: '',
  },
  info: {
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    row: '',
  },
  warn: {
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    row: 'bg-amber-50/50 dark:bg-amber-950/20',
  },
  error: {
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    row: 'bg-red-50/50 dark:bg-red-950/20',
  },
};

const MODULES = [
  '', 'runtime', 'planner', 'executor', 'verifier', 'cognition',
  'browser', 'handler', 'api', 'scheduler', 'worker', 'llm', 'db',
];

/* ── Helpers ──────────────────────────────────────────────── */

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      + '.' + String(d.getMilliseconds()).padStart(3, '0');
  } catch {
    return ts;
  }
}

function getLevelColor(level: string) {
  return LEVEL_COLORS[level.toLowerCase()] ?? LEVEL_COLORS.info;
}

/* ── LogsPage ─────────────────────────────────────────────── */

export function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterLevel, setFilterLevel] = useState('');
  const [filterModule, setFilterModule] = useState('');
  const [filterRunId, setFilterRunId] = useState('');
  const [filterText, setFilterText] = useState('');

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Streaming
  const [streaming, setStreaming] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Expanded row
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // New-log flash tracking
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  /* ── Fetch logs ───────────────────────────────────────────── */

  const fetchLogs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (filterLevel) params.set('level', filterLevel);
      if (filterModule) params.set('module', filterModule);
      if (filterRunId) params.set('runId', filterRunId);
      if (filterText) params.set('search', filterText);

      const res = await apiFetch(`/logs?${params.toString()}`);
      const data = await res.json();
      setLogs(data.logs ?? data ?? []);
    } catch (e: any) {
      if (!silent) setError(e.message || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [filterLevel, filterModule, filterRunId, filterText]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  /* ── Auto-refresh ─────────────────────────────────────────── */

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => fetchLogs(true), 3000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchLogs]);

  /* ── Streaming via EventSource ────────────────────────────── */

  const toggleStreaming = useCallback(() => {
    if (streaming && eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setStreaming(false);
      return;
    }

    const url = `${API}/logs/stream`;
    const es = new EventSource(url);
    eventSourceRef.current = es;
    setStreaming(true);

    es.onmessage = (event) => {
      try {
        const entry: LogEntry = JSON.parse(event.data);
        const logKey = entry.timestamp + entry.message;
        setNewIds((prev) => new Set(prev).add(logKey));
        setLogs((prev) => [entry, ...prev].slice(0, 500));

        // Remove flash after 2s
        setTimeout(() => {
          setNewIds((prev) => {
            const next = new Set(prev);
            next.delete(logKey);
            return next;
          });
        }, 2000);
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setStreaming(false);
    };
  }, [streaming]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  /* ── Export ────────────────────────────────────────────────── */

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `logs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [logs]);

  /* ── Render ───────────────────────────────────────────────── */

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Logs</h1>
            <p className="text-sm text-gray-500 mt-0.5">Real-time system log viewer</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Streaming toggle */}
            <button
              onClick={toggleStreaming}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${
                streaming
                  ? 'border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300'
                  : 'border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {streaming ? 'Streaming...' : 'Live Stream'}
            </button>

            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${
                autoRefresh
                  ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                  : 'border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh'}
            </button>

            {/* Refresh */}
            <button
              onClick={() => fetchLogs()}
              className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            >
              Refresh
            </button>

            {/* Export */}
            <button
              onClick={handleExport}
              disabled={logs.length === 0}
              className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-40"
            >
              Export JSON
            </button>
          </div>
        </div>
      </header>

      {/* Filter bar */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 px-6 py-3 flex flex-wrap items-center gap-3">
        <div>
          <label className="text-[10px] text-gray-500 uppercase block mb-0.5">Level</label>
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All levels</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] text-gray-500 uppercase block mb-0.5">Module</label>
          <select
            value={filterModule}
            onChange={(e) => setFilterModule(e.target.value)}
            className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All modules</option>
            {MODULES.filter(Boolean).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] text-gray-500 uppercase block mb-0.5">Run ID</label>
          <input
            type="text"
            value={filterRunId}
            onChange={(e) => setFilterRunId(e.target.value)}
            placeholder="Filter by run..."
            className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 w-36 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="text-[10px] text-gray-500 uppercase block mb-0.5">Search</label>
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Search messages..."
            className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 w-48 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-end ml-auto">
          <span className="text-[10px] text-gray-400">{logs.length} entries</span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-3 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      )}

      {/* Log table */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-6 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-8 rounded bg-gradient-to-r from-gray-100 via-gray-200 to-gray-100 dark:from-gray-800 dark:via-gray-700 dark:to-gray-800 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && logs.length === 0 && (
          <div className="text-center py-16">
            <svg className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-700 mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>
            <p className="text-gray-500 text-sm">No log entries found</p>
          </div>
        )}

        {!loading && logs.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-100 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-500 w-24">Time</th>
                <th className="text-left px-2 py-2 font-medium text-gray-500 w-16">Level</th>
                <th className="text-left px-2 py-2 font-medium text-gray-500 w-24">Module</th>
                <th className="text-left px-2 py-2 font-medium text-gray-500">Message</th>
                <th className="text-left px-2 py-2 font-medium text-gray-500 w-24">Run ID</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => {
                const logKey = log.timestamp + log.message;
                const isNew = newIds.has(logKey);
                const isExpanded = expandedIdx === i;
                const colors = getLevelColor(log.level);

                return (
                  <tr key={i} className="group">
                    {/* Main row */}
                    <td
                      colSpan={5}
                      className="p-0"
                    >
                      <div
                        onClick={() => setExpandedIdx(isExpanded ? null : i)}
                        className={`flex items-center cursor-pointer border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors ${colors.row} ${
                          isNew ? 'animate-pulse bg-blue-50 dark:bg-blue-950/30' : ''
                        }`}
                      >
                        <span className="px-4 py-1.5 w-24 flex-shrink-0 text-gray-500 font-mono">
                          {formatTimestamp(log.timestamp)}
                        </span>
                        <span className="px-2 py-1.5 w-16 flex-shrink-0">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${colors.badge}`}>
                            {log.level}
                          </span>
                        </span>
                        <span className="px-2 py-1.5 w-24 flex-shrink-0 text-gray-500 font-mono truncate">
                          {log.module}
                        </span>
                        <span className="px-2 py-1.5 flex-1 min-w-0 truncate">
                          {log.message}
                        </span>
                        <span className="px-2 py-1.5 w-24 flex-shrink-0 text-gray-400 font-mono truncate">
                          {log.runId ? log.runId.slice(0, 8) : ''}
                        </span>
                      </div>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-3">
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-4 text-xs">
                              <div>
                                <span className="text-gray-400 font-medium">Timestamp:</span>{' '}
                                <span className="font-mono">{log.timestamp}</span>
                              </div>
                              <div>
                                <span className="text-gray-400 font-medium">Level:</span>{' '}
                                <span className={`font-semibold uppercase ${colors.badge} px-1 rounded`}>{log.level}</span>
                              </div>
                              <div>
                                <span className="text-gray-400 font-medium">Module:</span>{' '}
                                <span className="font-mono">{log.module}</span>
                              </div>
                              {log.runId && (
                                <div>
                                  <span className="text-gray-400 font-medium">Run ID:</span>{' '}
                                  <span className="font-mono">{log.runId}</span>
                                </div>
                              )}
                            </div>
                            <div>
                              <span className="text-gray-400 font-medium text-xs">Message:</span>
                              <p className="mt-1 text-sm whitespace-pre-wrap">{log.message}</p>
                            </div>
                            {log.extra && Object.keys(log.extra).length > 0 && (
                              <div>
                                <span className="text-gray-400 font-medium text-xs">Extra:</span>
                                <pre className="mt-1 text-[11px] font-mono bg-white dark:bg-gray-800 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                                  {JSON.stringify(log.extra, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default LogsPage;
