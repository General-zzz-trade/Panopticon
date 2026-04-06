import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';

interface QuickStat {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}

export default function OsintDashboard() {
  const navigate = useNavigate();
  const [target, setTarget] = useState('');
  const [recentScans, setRecentScans] = useState<any[]>([]);
  const [stats, setStats] = useState<QuickStat[]>([
    { label: 'Investigations', value: 0, sub: 'total', color: 'text-osint-accent' },
    { label: 'Entities Found', value: 0, sub: 'across all scans', color: 'text-osint-cyan' },
    { label: 'Vulnerabilities', value: 0, sub: 'identified', color: 'text-osint-amber' },
    { label: 'Active Modules', value: 7, sub: 'ready', color: 'text-osint-accent' },
  ]);

  const modules = [
    { id: 'investigate', icon: '⌕', label: 'Full Investigation', desc: 'Domain + Network + Web + Risk Assessment', path: '/investigate', color: 'from-green-500/10 to-cyan-500/10 border-green-500/20' },
    { id: 'domain', icon: '◎', label: 'Domain Recon', desc: 'WHOIS, DNS, Subdomains, Certificates', path: '/domain', color: 'from-cyan-500/10 to-blue-500/10 border-cyan-500/20' },
    { id: 'network', icon: '◉', label: 'Network Scan', desc: 'Port Scan, GeoIP, Banners, Traceroute', path: '/network', color: 'from-purple-500/10 to-pink-500/10 border-purple-500/20' },
    { id: 'identity', icon: '⊕', label: 'Identity Lookup', desc: '37+ Platforms, Email Validation, SMTP', path: '/identity', color: 'from-amber-500/10 to-orange-500/10 border-amber-500/20' },
    { id: 'webintel', icon: '◈', label: 'Web Intelligence', desc: 'Tech Stack, Wayback, Dorks, Robots', path: '/webintel', color: 'from-emerald-500/10 to-teal-500/10 border-emerald-500/20' },
    { id: 'reports', icon: '⊞', label: 'Reports', desc: 'Investigation History & Export', path: '/reports', color: 'from-slate-500/10 to-gray-500/10 border-slate-500/20' },
  ];

  const quickLaunch = () => {
    if (!target.trim()) return;
    const t = target.trim();
    if (t.includes('@')) navigate(`/identity?q=${encodeURIComponent(t)}`);
    else if (/^\d+\.\d+\.\d+\.\d+$/.test(t)) navigate(`/network?q=${encodeURIComponent(t)}`);
    else navigate(`/investigate?q=${encodeURIComponent(t)}`);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-osint-bg p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Hero / Quick Launch */}
        <div className="bg-gradient-to-br from-osint-panel to-osint-bg border border-osint-border rounded-xl p-8">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-bold mb-1">
              <span className="text-osint-accent">Panopticon</span> — OSINT Platform
            </h1>
            <p className="text-sm text-osint-muted mb-6">
              Open source intelligence gathering — no API keys required. Domain recon, network scanning,
              identity enumeration, web intelligence, and automated risk assessment.
            </p>

            {/* Quick search */}
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-osint-accent font-mono text-sm">$</div>
                <input
                  type="text"
                  value={target}
                  onChange={e => setTarget(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') quickLaunch(); }}
                  placeholder="Enter target — domain, IP, email, or username..."
                  className="w-full pl-7 pr-4 py-3 bg-osint-input border border-osint-border rounded-lg text-sm font-mono text-osint-text placeholder-osint-muted/50 focus:outline-none focus:border-osint-accent/40 focus:ring-1 focus:ring-osint-accent/20 transition"
                />
              </div>
              <button
                onClick={quickLaunch}
                disabled={!target.trim()}
                className="px-6 py-3 bg-osint-accent/10 border border-osint-accent/30 text-osint-accent font-mono text-sm rounded-lg hover:bg-osint-accent/20 disabled:opacity-30 disabled:cursor-not-allowed transition glow-green"
              >
                INVESTIGATE
              </button>
            </div>

            {/* Quick examples */}
            <div className="flex gap-2 mt-3">
              <span className="text-[10px] text-osint-muted">Try:</span>
              {['github.com', '8.8.8.8', 'torvalds', 'info@github.com'].map(ex => (
                <button
                  key={ex}
                  onClick={() => setTarget(ex)}
                  className="text-[10px] font-mono text-osint-cyan/70 hover:text-osint-cyan bg-osint-cyan/5 px-2 py-0.5 rounded border border-osint-cyan/10 hover:border-osint-cyan/30 transition"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-3">
          {stats.map(stat => (
            <div key={stat.label} className="bg-osint-panel border border-osint-border rounded-lg p-4">
              <div className={`text-2xl font-bold font-mono ${stat.color}`}>{stat.value}</div>
              <div className="text-xs text-osint-text mt-1">{stat.label}</div>
              <div className="text-[10px] text-osint-muted">{stat.sub}</div>
            </div>
          ))}
        </div>

        {/* Module Cards */}
        <div>
          <h2 className="text-xs font-bold text-osint-muted tracking-[.15em] uppercase mb-3">MODULES</h2>
          <div className="grid grid-cols-3 gap-3">
            {modules.map(mod => (
              <button
                key={mod.id}
                onClick={() => navigate(mod.path)}
                className={`text-left p-5 rounded-xl border bg-gradient-to-br ${mod.color} hover:scale-[1.01] transition-all group`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl font-mono text-osint-accent/80 group-hover:text-osint-accent transition">{mod.icon}</span>
                  <div>
                    <h3 className="text-sm font-semibold text-osint-text group-hover:text-osint-accent transition">{mod.label}</h3>
                    <p className="text-xs text-osint-muted mt-1">{mod.desc}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Capabilities */}
        <div className="bg-osint-panel border border-osint-border rounded-xl p-6">
          <h2 className="text-xs font-bold text-osint-muted tracking-[.15em] uppercase mb-4">CAPABILITIES — NO API KEYS REQUIRED</h2>
          <div className="grid grid-cols-4 gap-4 text-xs">
            <div>
              <h3 className="text-osint-accent font-semibold mb-2">Domain</h3>
              <ul className="space-y-1 text-osint-muted">
                <li>WHOIS Lookup</li><li>DNS Enumeration (10 types)</li>
                <li>Subdomain Discovery</li><li>Certificate Transparency</li>
                <li>Zone Transfer Test</li><li>Reverse DNS</li>
              </ul>
            </div>
            <div>
              <h3 className="text-osint-cyan font-semibold mb-2">Network</h3>
              <ul className="space-y-1 text-osint-muted">
                <li>TCP Port Scan (30 ports)</li><li>Service Banner Grab</li>
                <li>IP Geolocation</li><li>Traceroute</li>
                <li>HTTP Header Analysis</li><li>Security Header Audit</li>
              </ul>
            </div>
            <div>
              <h3 className="text-osint-amber font-semibold mb-2">Identity</h3>
              <ul className="space-y-1 text-osint-muted">
                <li>Username Enum (37 sites)</li><li>Email MX Validation</li>
                <li>SMTP Verification</li><li>Disposable Detection</li>
                <li>Social Profile Discovery</li><li>Cross-Platform Linking</li>
              </ul>
            </div>
            <div>
              <h3 className="text-emerald-400 font-semibold mb-2">Web Intel</h3>
              <ul className="space-y-1 text-osint-muted">
                <li>Tech Stack (50+ sigs)</li><li>Wayback Machine</li>
                <li>Google Dorks (12 types)</li><li>Robots.txt Analysis</li>
                <li>Sitemap Parsing</li><li>Link Extraction</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
