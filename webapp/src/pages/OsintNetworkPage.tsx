import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api/client';

// ── Types ────────────────────────────────────────────

interface PortResult { port: number; state: 'open' | 'filtered' | 'closed'; service?: string }
interface GeoIPResult { [key: string]: unknown; lat?: number; lon?: number }
interface HeaderAudit { header: string; present: boolean; value?: string }
interface NetworkResult {
  ports?: PortResult[];
  geoip?: GeoIPResult;
  headers?: HeaderAudit[];
}

// ── Component ────────────────────────────────────────

export default function OsintNetworkPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [target, setTarget] = useState(searchParams.get('q') ?? '');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [ports, setPorts] = useState<PortResult[] | null>(null);
  const [geoip, setGeoip] = useState<GeoIPResult | null>(null);
  const [headers, setHeaders] = useState<HeaderAudit[] | null>(null);
  const [error, setError] = useState('');

  // Auto-run if ?q= is present on mount
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) { setTarget(q); runFullRecon(q); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => { setPorts(null); setGeoip(null); setHeaders(null); setError(''); };

  const runPortScan = useCallback(async (t?: string) => {
    const host = t ?? target;
    if (!host) return;
    reset(); setLoading(true); setProgress('Scanning ports...');
    setSearchParams({ q: host });
    try {
      const res = await apiFetch('/osint/portscan', { method: 'POST', body: JSON.stringify({ target: host }) });
      const data = await res.json();
      setPorts(data.ports ?? []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setProgress(''); }
  }, [target, setSearchParams]);

  const runGeoIP = useCallback(async (t?: string) => {
    const host = t ?? target;
    if (!host) return;
    reset(); setLoading(true); setProgress('Looking up GeoIP...');
    setSearchParams({ q: host });
    try {
      const res = await apiFetch(`/osint/geoip/${encodeURIComponent(host)}`);
      const data = await res.json();
      setGeoip(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setProgress(''); }
  }, [target, setSearchParams]);

  const runFullRecon = useCallback(async (t?: string) => {
    const host = t ?? target;
    if (!host) return;
    reset(); setLoading(true);
    setSearchParams({ q: host });
    try {
      setProgress('Running full network recon...');
      const res = await apiFetch('/osint/network', { method: 'POST', body: JSON.stringify({ target: host }) });
      const data: NetworkResult = await res.json();
      if (data.ports) setPorts(data.ports);
      if (data.geoip) setGeoip(data.geoip);
      if (data.headers) setHeaders(data.headers);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setProgress(''); }
  }, [target, setSearchParams]);

  const portColor = (s: string) =>
    s === 'open' ? 'text-osint-accent' : s === 'filtered' ? 'text-osint-muted' : 'text-red-500';

  const handleKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') runFullRecon(); };

  return (
    <div className="min-h-screen bg-osint-bg text-osint-text p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-osint-accent tracking-wide">Network Reconnaissance</h1>
        <p className="text-osint-muted text-sm mt-1">Port scanning, GeoIP lookup, and security header audit</p>
      </div>

      {/* Input bar */}
      <div className="bg-osint-panel border border-osint-border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-osint-accent font-mono text-lg">$</span>
          <input
            type="text"
            value={target}
            onChange={e => setTarget(e.target.value)}
            onKeyDown={handleKey}
            placeholder="IP or domain..."
            className="flex-1 bg-osint-input border border-osint-border rounded px-3 py-2 font-mono text-osint-text placeholder:text-osint-muted focus:outline-none focus:border-osint-accent"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={() => runPortScan()} disabled={loading || !target}
            className="px-4 py-2 rounded bg-osint-card border border-osint-border text-osint-cyan hover:bg-osint-border disabled:opacity-40 transition text-sm">
            Port Scan
          </button>
          <button onClick={() => runGeoIP()} disabled={loading || !target}
            className="px-4 py-2 rounded bg-osint-card border border-osint-border text-osint-cyan hover:bg-osint-border disabled:opacity-40 transition text-sm">
            GeoIP
          </button>
          <button onClick={() => runFullRecon()} disabled={loading || !target}
            className="px-4 py-2 rounded bg-osint-accent/20 border border-osint-accent text-osint-accent hover:bg-osint-accent/30 disabled:opacity-40 transition text-sm font-semibold">
            Full Network Recon
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 text-osint-cyan">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
          <span className="font-mono text-sm">{progress}</span>
        </div>
      )}

      {/* Error */}
      {error && <div className="bg-red-900/30 border border-red-500 rounded-lg p-3 text-red-400 text-sm font-mono">{error}</div>}

      {/* Port scan results */}
      {ports && (
        <div className="bg-osint-panel border border-osint-border rounded-lg p-4">
          <h2 className="text-lg font-semibold text-osint-cyan mb-3">Port Scan Results</h2>
          {ports.length === 0 ? (
            <p className="text-osint-muted text-sm">No port data returned.</p>
          ) : (
            <table className="w-full text-sm font-mono">
              <thead><tr className="text-osint-muted border-b border-osint-border">
                <th className="text-left py-1 pr-4">Port</th>
                <th className="text-left py-1 pr-4">State</th>
                <th className="text-left py-1">Service</th>
              </tr></thead>
              <tbody>
                {ports.map(p => (
                  <tr key={p.port} className="border-b border-osint-border/40">
                    <td className="py-1 pr-4 text-osint-text">{p.port}</td>
                    <td className={`py-1 pr-4 font-semibold ${portColor(p.state)}`}>{p.state}</td>
                    <td className="py-1 text-osint-muted">{p.service ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* GeoIP results */}
      {geoip && (
        <div className="bg-osint-panel border border-osint-border rounded-lg p-4">
          <h2 className="text-lg font-semibold text-osint-cyan mb-3">GeoIP Data</h2>
          <table className="w-full text-sm font-mono">
            <tbody>
              {Object.entries(geoip).map(([k, v]) => (
                <tr key={k} className="border-b border-osint-border/40">
                  <td className="py-1 pr-4 text-osint-muted w-1/3">{k}</td>
                  <td className="py-1 text-osint-text">{String(v ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {geoip.lat != null && geoip.lon != null && (
            <p className="mt-3 text-xs text-osint-muted">
              Coordinates: <span className="text-osint-accent">{geoip.lat}, {geoip.lon}</span>
            </p>
          )}
        </div>
      )}

      {/* Security headers */}
      {headers && (
        <div className="bg-osint-panel border border-osint-border rounded-lg p-4">
          <h2 className="text-lg font-semibold text-osint-cyan mb-3">Security Headers Audit</h2>
          <table className="w-full text-sm font-mono">
            <thead><tr className="text-osint-muted border-b border-osint-border">
              <th className="text-left py-1 w-8"></th>
              <th className="text-left py-1 pr-4">Header</th>
              <th className="text-left py-1">Value</th>
            </tr></thead>
            <tbody>
              {headers.map(h => (
                <tr key={h.header} className="border-b border-osint-border/40">
                  <td className="py-1">{h.present ? <span className="text-osint-accent">&#10003;</span> : <span className="text-red-500">&#10007;</span>}</td>
                  <td className="py-1 pr-4 text-osint-text">{h.header}</td>
                  <td className="py-1 text-osint-muted truncate max-w-xs">{h.value ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
