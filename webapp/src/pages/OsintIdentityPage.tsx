import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api/client';

// ── Types ────────────────────────────────────────────

interface PlatformResult {
  platform: string;
  found: boolean;
  url?: string;
  category?: string;
}

interface EmailValidation {
  format: boolean;
  mx_records: boolean;
  disposable: boolean;
  role_account: boolean;
  smtp_reachable: boolean;
  [key: string]: unknown;
}

type Mode = 'username' | 'email';

const CATEGORIES = ['All', 'Dev', 'Social', 'Professional', 'Gaming', 'Media', 'Finance'];

// ── Component ────────────────────────────────────────

export default function OsintIdentityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [mode, setMode] = useState<Mode>('username');
  const [loading, setLoading] = useState(false);
  const [platforms, setPlatforms] = useState<PlatformResult[]>([]);
  const [emailResult, setEmailResult] = useState<EmailValidation | null>(null);
  const [activeCategory, setActiveCategory] = useState('All');
  const [error, setError] = useState('');

  // Run search from URL param on mount
  useEffect(() => {
    const q = searchParams.get('q');
    if (q && !platforms.length && !emailResult) {
      setQuery(q);
      handleUsernameSearch(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUsernameSearch = useCallback(async (q?: string) => {
    const target = (q ?? query).trim();
    if (!target) return;
    setMode('username');
    setLoading(true);
    setError('');
    setEmailResult(null);
    setSearchParams({ q: target });
    try {
      const categories = activeCategory === 'All' ? undefined : [activeCategory.toLowerCase()];
      const res = await apiFetch('/osint/username', {
        method: 'POST',
        body: JSON.stringify({ username: target, categories }),
      });
      const data = await res.json();
      setPlatforms(data.results ?? data.platforms ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Username search failed');
    } finally {
      setLoading(false);
    }
  }, [query, activeCategory, setSearchParams]);

  const handleEmailValidation = useCallback(async () => {
    const target = query.trim();
    if (!target) return;
    setMode('email');
    setLoading(true);
    setError('');
    setPlatforms([]);
    setSearchParams({ q: target });
    try {
      const res = await apiFetch(`/osint/email/${encodeURIComponent(target)}`);
      const data = await res.json();
      setEmailResult(data);
    } catch (e: any) {
      setError(e.message ?? 'Email validation failed');
    } finally {
      setLoading(false);
    }
  }, [query, setSearchParams]);

  const filtered = activeCategory === 'All'
    ? platforms
    : platforms.filter(p => (p.category ?? '').toLowerCase() === activeCategory.toLowerCase());

  const foundCount = filtered.filter(p => p.found).length;

  return (
    <div className="min-h-screen bg-osint-bg text-osint-text p-6">
      {/* Header */}
      <h1 className="text-2xl font-bold text-osint-accent mb-1 tracking-wide">OSINT Identity Lookup</h1>
      <p className="text-osint-muted text-sm mb-6">Search usernames across platforms or validate email addresses</p>

      {/* Search bar */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 flex items-center bg-osint-input border border-osint-border rounded-lg px-3 py-2">
          <span className="text-osint-accent font-mono mr-2 select-none">$</span>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUsernameSearch()}
            placeholder="Username or email..."
            className="flex-1 bg-transparent outline-none font-mono text-osint-text placeholder:text-osint-muted"
          />
        </div>
        <button
          onClick={() => handleUsernameSearch()}
          disabled={loading}
          className="px-4 py-2 bg-osint-accent/20 text-osint-accent border border-osint-accent/40 rounded-lg
                     hover:bg-osint-accent/30 transition font-medium disabled:opacity-40"
        >
          Search Username
        </button>
        <button
          onClick={handleEmailValidation}
          disabled={loading}
          className="px-4 py-2 bg-osint-cyan/20 text-osint-cyan border border-osint-cyan/40 rounded-lg
                     hover:bg-osint-cyan/30 transition font-medium disabled:opacity-40"
        >
          Validate Email
        </button>
      </div>

      {/* Category filters */}
      {mode === 'username' && (
        <div className="flex gap-2 mb-5 flex-wrap">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1 rounded-full text-sm border transition ${
                activeCategory === cat
                  ? 'bg-osint-accent/20 text-osint-accent border-osint-accent/50'
                  : 'bg-osint-card border-osint-border text-osint-muted hover:text-osint-text'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-osint-muted mb-4">
          <div className="w-4 h-4 border-2 border-osint-accent border-t-transparent rounded-full animate-spin" />
          Scanning...
        </div>
      )}

      {/* Username results */}
      {mode === 'username' && platforms.length > 0 && !loading && (
        <>
          <div className="mb-4 text-sm text-osint-muted">
            Found <span className="text-osint-accent font-bold">{foundCount}</span>
            /{filtered.length} platforms
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filtered.map(p => (
              <div
                key={p.platform}
                className={`rounded-lg p-3 border transition ${
                  p.found
                    ? 'bg-osint-card border-osint-accent/50 shadow-[0_0_8px_rgba(0,255,136,0.1)]'
                    : 'bg-osint-panel border-osint-border/40 opacity-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm truncate">{p.platform}</span>
                  {p.found ? (
                    <span className="text-osint-accent text-lg">&#10003;</span>
                  ) : (
                    <span className="text-osint-muted text-xs">--</span>
                  )}
                </div>
                {p.found && p.url && (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-osint-cyan hover:underline truncate block mt-1"
                  >
                    {p.url}
                  </a>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Email validation results */}
      {mode === 'email' && emailResult && !loading && (
        <div className="max-w-lg">
          <h2 className="text-lg font-semibold text-osint-cyan mb-3">Email Validation</h2>
          <table className="w-full text-sm border border-osint-border rounded-lg overflow-hidden">
            <tbody>
              {([
                ['Format Valid', emailResult.format],
                ['MX Records', emailResult.mx_records],
                ['Disposable', emailResult.disposable],
                ['Role Account', emailResult.role_account],
                ['SMTP Reachable', emailResult.smtp_reachable],
              ] as [string, unknown][]).map(([label, value]) => (
                <tr key={label} className="border-b border-osint-border/50 last:border-b-0">
                  <td className="px-4 py-2 text-osint-muted bg-osint-panel font-medium">{label}</td>
                  <td className="px-4 py-2 bg-osint-card">
                    {typeof value === 'boolean' ? (
                      <span className={value ? 'text-osint-accent' : 'text-osint-amber'}>
                        {value ? 'Yes' : 'No'}
                      </span>
                    ) : (
                      String(value ?? '--')
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && platforms.length === 0 && !emailResult && (
        <div className="text-center text-osint-muted mt-20">
          <p className="text-lg mb-1">Enter a username or email to begin</p>
          <p className="text-sm">Results will appear here</p>
        </div>
      )}
    </div>
  );
}
