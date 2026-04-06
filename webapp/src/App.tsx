import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from './context/AppContext';
import { useChat } from './hooks/useChat';
import { Settings as SettingsModal } from './components/Settings';
import type { Settings } from './types';
import { checkHealth } from './api/client';

const OsintDashboard = lazy(() => import('./pages/OsintDashboard'));
const OsintInvestigate = lazy(() => import('./pages/OsintInvestigate'));
const OsintDomain = lazy(() => import('./pages/OsintDomainPage'));
const OsintNetwork = lazy(() => import('./pages/OsintNetworkPage'));
const OsintIdentity = lazy(() => import('./pages/OsintIdentityPage'));
const OsintWebIntel = lazy(() => import('./pages/OsintWebIntelPage'));
const OsintReports = lazy(() => import('./pages/OsintReportsPage'));
const OsintThreat = lazy(() => import('./pages/OsintThreatPage'));
const OsintAsn = lazy(() => import('./pages/OsintAsnPage'));
const OsintCrawler = lazy(() => import('./pages/OsintCrawlerPage'));
const OsintBreach = lazy(() => import('./pages/OsintBreachPage'));
const OsintChain = lazy(() => import('./pages/OsintChainPage'));
const OsintMonitor = lazy(() => import('./pages/OsintMonitorPage'));
const OsintBatch = lazy(() => import('./pages/OsintBatchPage'));
const OsintGithub = lazy(() => import('./pages/OsintGithubPage'));

type ModalType = 'settings' | null;

interface NavItem {
  path: string;
  icon: string;
  label: string;
  section?: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/', icon: '⬡', label: 'Dashboard', section: 'Core' },
  { path: '/investigate', icon: '⌕', label: 'Investigate' },
  { path: '/domain', icon: '◎', label: 'Domain', section: 'Recon' },
  { path: '/network', icon: '◉', label: 'Network' },
  { path: '/identity', icon: '⊕', label: 'Identity' },
  { path: '/webintel', icon: '◈', label: 'Web Intel' },
  { path: '/threat', icon: '⚑', label: 'Threat Intel', section: 'Analysis' },
  { path: '/asn', icon: '⊘', label: 'ASN / Rev IP' },
  { path: '/crawler', icon: '⊚', label: 'Crawler' },
  { path: '/breach', icon: '⊗', label: 'Breach Check' },
  { path: '/github', icon: '⊛', label: 'GitHub Scan' },
  { path: '/chain', icon: '⊶', label: 'Chains', section: 'Automation' },
  { path: '/monitor', icon: '⊙', label: 'Monitor' },
  { path: '/batch', icon: '⊟', label: 'Batch' },
  { path: '/reports', icon: '⊞', label: 'Reports' },
];

function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center bg-osint-bg">
      <div className="text-center">
        <div className="spinner w-6 h-6 mx-auto mb-3" />
        <p className="text-xs text-osint-muted font-mono">LOADING MODULE...</p>
      </div>
    </div>
  );
}

function AppInner() {
  const { state, dispatch } = useApp();
  const { settings } = state;
  const chat = useChat();
  const navigate = useNavigate();
  const location = useLocation();
  const [modal, setModal] = useState<ModalType>(null);
  const [healthStatus, setHealthStatus] = useState<{ ok: boolean; text: string } | undefined>();
  const [time, setTime] = useState(new Date());

  // Always dark mode for OSINT
  useEffect(() => { document.documentElement.classList.add('dark'); }, []);

  // Clock
  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Health check
  useEffect(() => {
    const check = () => checkHealth()
      .then(h => setHealthStatus({ ok: h.status === 'ok', text: `${h.memoryMB?.heapUsed ?? 0}MB` }))
      .catch(() => setHealthStatus({ ok: false, text: 'OFFLINE' }));
    check();
    const iv = setInterval(check, 15000);
    return () => clearInterval(iv);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); setModal(m => m === 'settings' ? null : 'settings'); }
      if (e.key === 'Escape' && modal) setModal(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [modal]);

  return (
    <div className="flex h-full bg-osint-bg text-osint-text">

      {/* ── Left Sidebar — OSINT Nav ── */}
      <div className="w-[220px] flex-shrink-0 bg-osint-panel border-r border-osint-border flex flex-col">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-osint-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500/20 to-cyan-500/20 border border-osint-accent/30 flex items-center justify-center glow-green">
              <span className="text-osint-accent text-sm font-bold font-mono">P</span>
            </div>
            <div>
              <h1 className="text-sm font-bold text-osint-accent tracking-wide">PANOPTICON</h1>
              <p className="text-[9px] text-osint-muted font-mono tracking-widest">OSINT INTELLIGENCE</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item, idx) => {
            const active = location.pathname === item.path;
            return (
              <div key={item.path}>
                {item.section && (
                  <p className={`px-3 ${idx === 0 ? 'py-1.5' : 'pt-3 pb-1.5'} text-[9px] font-bold text-osint-muted tracking-[.2em] uppercase`}>{item.section}</p>
                )}
                <button
                  onClick={() => navigate(item.path)}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-all group ${
                    active
                      ? 'bg-osint-accent/10 text-osint-accent border border-osint-accent/20'
                      : 'text-osint-muted hover:text-osint-text hover:bg-white/[.03] border border-transparent'
                  }`}
                >
                  <span className={`font-mono text-sm leading-none ${active ? 'text-osint-accent' : 'text-osint-muted group-hover:text-osint-accent/60'}`}>
                    {item.icon}
                  </span>
                  <span className="font-medium tracking-wide">{item.label}</span>
                </button>
              </div>
            );
          })}
        </nav>

        {/* Bottom Status */}
        <div className="p-3 border-t border-osint-border space-y-2">
          {/* Settings */}
          <button
            onClick={() => setModal('settings')}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-osint-muted hover:text-osint-text hover:bg-white/[.03] transition"
          >
            <span className="font-mono text-base">⚙</span>
            <span>Settings</span>
          </button>

          {/* System Status */}
          <div className="px-3 py-2 bg-osint-bg rounded-md border border-osint-border">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${healthStatus?.ok ? 'bg-osint-accent pulse-dot' : 'bg-osint-red'}`} />
                <span className="text-[10px] font-mono text-osint-muted">
                  {healthStatus?.ok ? 'SYSTEM ONLINE' : 'OFFLINE'}
                </span>
              </div>
              <span className="text-[10px] font-mono text-osint-muted">{healthStatus?.text}</span>
            </div>
            <div className="text-[10px] font-mono text-osint-accent/60">
              {time.toLocaleTimeString('en-US', { hour12: false })} UTC
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-10 flex items-center justify-between px-5 border-b border-osint-border bg-osint-panel flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-osint-muted tracking-wider">
              {location.pathname === '/' ? 'DASHBOARD' : location.pathname.slice(1).toUpperCase().replace('/', ' > ')}
            </span>
          </div>
          <div className="flex items-center gap-4 text-[10px] font-mono text-osint-muted">
            <span>{time.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
            <span className="text-osint-accent">{time.toLocaleTimeString('en-US', { hour12: false })}</span>
          </div>
        </header>

        {/* Page Content */}
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<OsintDashboard />} />
            <Route path="/investigate" element={<OsintInvestigate chat={chat} />} />
            <Route path="/domain" element={<OsintDomain />} />
            <Route path="/network" element={<OsintNetwork />} />
            <Route path="/identity" element={<OsintIdentity />} />
            <Route path="/webintel" element={<OsintWebIntel />} />
            <Route path="/threat" element={<OsintThreat />} />
            <Route path="/asn" element={<OsintAsn />} />
            <Route path="/crawler" element={<OsintCrawler />} />
            <Route path="/breach" element={<OsintBreach />} />
            <Route path="/github" element={<OsintGithub />} />
            <Route path="/chain" element={<OsintChain />} />
            <Route path="/monitor" element={<OsintMonitor />} />
            <Route path="/batch" element={<OsintBatch />} />
            <Route path="/reports" element={<OsintReports />} />
          </Routes>
        </Suspense>
      </div>

      {/* Settings Modal */}
      <SettingsModal open={modal === 'settings'} onClose={() => setModal(null)} settings={settings}
        onSave={(s: Settings) => { dispatch({ type: 'SET_SETTINGS', settings: s }); setModal(null); }} />
    </div>
  );
}

export function App() {
  return <BrowserRouter><AppInner /></BrowserRouter>;
}
