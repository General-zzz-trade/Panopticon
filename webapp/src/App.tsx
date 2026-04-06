import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from './context/AppContext';
import { useChat } from './hooks/useChat';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { RightPanel } from './components/RightPanel';
import { StageBar } from './components/StageBar';
import { Inspector } from './components/Inspector';
import { Settings as SettingsModal } from './components/Settings';
import { Dashboard } from './components/Dashboard';
import { Shortcuts } from './components/Shortcuts';
import type { AgentEvent, Settings } from './types';
import {
  cancelRun, listConversations, deleteConversation, sendFeedback, checkHealth,
} from './api/client';

// Lazy-load page components
const TemplatesPage = lazy(() => import('./pages/TemplatesPage'));
const SchedulesPage = lazy(() => import('./pages/SchedulesPage'));
const WebhooksPage = lazy(() => import('./pages/WebhooksPage'));
const WorkflowsPage = lazy(() => import('./pages/WorkflowsPage'));
const LogsPage = lazy(() => import('./pages/LogsPage'));

/* ── i18n ─────────────────────────────────────────────────── */
const I18N: Record<string, Record<string, string>> = {
  en: { new_chat:'New chat', settings:'Settings', dashboard:'Dashboard', cancel:'Stop', export_label:'Export',
        templates:'Templates', schedules:'Schedules', webhooks:'Webhooks', workflows:'Workflows', logs:'Logs', chat:'Chat' },
  zh: { new_chat:'\u65B0\u5BF9\u8BDD', settings:'\u8BBE\u7F6E', dashboard:'\u4EEA\u8868\u76D8', cancel:'\u505C\u6B62', export_label:'\u5BFC\u51FA',
        templates:'\u6A21\u677F', schedules:'\u5B9A\u65F6\u4EFB\u52A1', webhooks:'Webhooks', workflows:'\u5DE5\u4F5C\u6D41', logs:'\u65E5\u5FD7', chat:'\u804A\u5929' },
};

type ModalType = 'settings' | 'dashboard' | 'shortcuts' | null;

// Nav items for sidebar
const NAV_ITEMS = [
  { path: '/', icon: '\uD83D\uDCAC', key: 'chat' },
  { path: '/templates', icon: '\uD83D\uDCE6', key: 'templates' },
  { path: '/schedules', icon: '\u23F0', key: 'schedules' },
  { path: '/workflows', icon: '\u26A1', key: 'workflows' },
  { path: '/webhooks', icon: '\uD83D\uDD17', key: 'webhooks' },
  { path: '/logs', icon: '\uD83D\uDCCB', key: 'logs' },
];

function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
    </div>
  );
}

function AppInner() {
  const { state, dispatch } = useApp();
  const { settings, conversations, activeConvoId } = state;
  const chat = useChat();
  const navigate = useNavigate();
  const location = useLocation();
  const [modal, setModal] = useState<ModalType>(null);
  const [inspectEvent, setInspectEvent] = useState<AgentEvent | null>(null);
  const [healthStatus, setHealthStatus] = useState<{ ok: boolean; text: string } | undefined>();

  const t = useCallback((key: string) => I18N[settings.lang]?.[key] ?? I18N.en[key] ?? key, [settings.lang]);
  const isChat = location.pathname === '/';

  // Dark mode
  useEffect(() => { document.documentElement.classList.toggle('dark', settings.dark); }, [settings.dark]);

  // Health check
  useEffect(() => {
    const check = () => checkHealth().then(h => setHealthStatus({ ok: h.status === 'ok', text: `Online · ${h.memoryMB?.heapUsed ?? 0}MB` })).catch(() => setHealthStatus({ ok: false, text: 'Offline' }));
    check(); const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, []);

  // Load conversations
  useEffect(() => {
    listConversations().then(r => dispatch({ type: 'SET_CONVERSATIONS', conversations: r.conversations })).catch(() => {});
  }, [dispatch]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); dispatch({ type: 'SET_SETTINGS', settings: { sidebarOpen: !settings.sidebarOpen } }); }
      else if ((e.ctrlKey || e.metaKey) && e.key === '.') { e.preventDefault(); dispatch({ type: 'SET_SETTINGS', settings: { panelOpen: !settings.panelOpen } }); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); chat.newChat(); navigate('/'); }
      else if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); setModal(m => m === 'settings' ? null : 'settings'); }
      else if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); setModal(m => m === 'shortcuts' ? null : 'shortcuts'); }
      else if (e.key === 'Escape') { if (inspectEvent) setInspectEvent(null); else if (modal) setModal(null); }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dispatch, settings, modal, inspectEvent, chat, navigate]);

  // Handlers
  const handleSelectConvo = useCallback(async (id: string) => {
    navigate('/');
    chat.loadConversation(id);
    listConversations().then(r => dispatch({ type: 'SET_CONVERSATIONS', conversations: r.conversations })).catch(() => {});
  }, [chat, dispatch, navigate]);

  const handleDeleteConvo = useCallback(async (id: string) => {
    try { await deleteConversation(id); dispatch({ type: 'SET_CONVERSATIONS', conversations: conversations.filter(c => c.id !== id) }); if (activeConvoId === id) chat.newChat(); } catch {}
  }, [dispatch, conversations, activeConvoId, chat]);

  const handleFeedback = useCallback((msgId: string, rating: 'up' | 'down') => {
    if (chat.runId) sendFeedback(chat.runId, rating).catch(() => {});
  }, [chat.runId]);

  const handleExport = useCallback(() => {
    let md = '# Conversation\n\n';
    for (const m of chat.messages) md += `**${m.role === 'user' ? 'You' : settings.agentName}:**\n\n${m.content}\n\n---\n\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `chat-${Date.now()}.md`; a.click(); URL.revokeObjectURL(a.href);
  }, [chat.messages, settings.agentName]);

  const chatTitle = chat.messages.find(m => m.role === 'user')?.content.slice(0, 50) || t('new_chat');

  // Page titles
  const pageTitle = isChat ? chatTitle : t(NAV_ITEMS.find(n => n.path === location.pathname)?.key || 'chat');

  return (
    <div className="flex h-full bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Sidebar */}
      <aside className={`flex flex-col flex-shrink-0 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transition-all duration-200 ${settings.sidebarOpen ? 'w-60' : 'w-0 min-w-0 overflow-hidden opacity-0 pointer-events-none border-none'}`}>
        {/* Navigation */}
        <nav className="p-2 border-b border-gray-200 dark:border-gray-800 space-y-0.5">
          {NAV_ITEMS.map(item => (
            <button key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition ${location.pathname === item.path ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'}`}
            >
              <span className="text-base">{item.icon}</span>
              <span>{t(item.key)}</span>
            </button>
          ))}
        </nav>

        {/* Sidebar content — only show conversation list on chat page */}
        {isChat ? (
          <Sidebar
            conversations={conversations}
            activeConversationId={activeConvoId}
            settings={settings}
            healthStatus={healthStatus}
            authUser={state.jwtUser?.email ?? null}
            onNewChat={() => { chat.newChat(); navigate('/'); }}
            onSelectConvo={handleSelectConvo}
            onDeleteConvo={handleDeleteConvo}
            onOpenSettings={() => setModal('settings')}
            onOpenDashboard={() => setModal('dashboard')}
            onToggleTheme={() => dispatch({ type: 'SET_SETTINGS', settings: { dark: !settings.dark } })}
            onToggleLang={() => dispatch({ type: 'SET_SETTINGS', settings: { lang: settings.lang === 'en' ? 'zh' : 'en' } })}
          />
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="flex-1" />
            <div className="p-3 border-t border-gray-200 dark:border-gray-800 space-y-2">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${healthStatus?.ok ? 'bg-green-500' : 'bg-red-500'}`} />
                <span>{healthStatus?.text || 'Checking...'}</span>
              </div>
              <div className="flex items-center gap-1 text-xs">
                <button onClick={() => setModal('settings')} className="px-2 py-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">{t('settings')}</button>
                <button onClick={() => setModal('dashboard')} className="px-2 py-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">{t('dashboard')}</button>
                <a href="/api/v1/docs" target="_blank" rel="noopener" className="px-2 py-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">API</a>
                <span className="flex-1" />
                <button onClick={() => dispatch({ type: 'SET_SETTINGS', settings: { dark: !settings.dark } })} className="px-1.5 py-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-500" title="Theme">&#9684;</button>
                <button onClick={() => dispatch({ type: 'SET_SETTINGS', settings: { lang: settings.lang === 'en' ? 'zh' : 'en' } })} className="px-1.5 py-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-500 font-mono text-[10px]">{settings.lang.toUpperCase()}</button>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="border-b border-gray-200 dark:border-gray-800 px-4 md:px-6 flex-shrink-0">
          <div className="flex items-center justify-between gap-2 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={() => dispatch({ type: 'SET_SETTINGS', settings: { sidebarOpen: !settings.sidebarOpen } })}
                className="px-2 py-1 text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition" title="Ctrl+B">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>
              </button>
              <h1 className="font-semibold truncate">{pageTitle}</h1>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isChat && chat.sending && (
                <button onClick={() => { if (chat.runId) cancelRun(chat.runId).catch(() => {}); dispatch({ type: 'SET_STAGE', stage: 'done' }); dispatch({ type: 'SET_SENDING', sending: false }); }}
                  className="flex items-center gap-1 px-3 py-1 text-xs border border-red-300 text-red-700 dark:text-red-400 dark:border-red-900 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg transition">
                  &#9632; {t('cancel')}
                </button>
              )}
              {isChat && chat.tasksTotal > 0 && chat.sending && (
                <span className="text-xs text-gray-500 font-mono">{chat.tasksDone}/{chat.tasksTotal}</span>
              )}
              {isChat && (
                <select value={settings.mode} onChange={e => dispatch({ type: 'SET_SETTINGS', settings: { mode: e.target.value } })}
                  className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 focus:outline-none">
                  <option value="">Auto</option><option value="sequential">Fast</option><option value="react">Deep</option><option value="cli">Shell</option>
                </select>
              )}
              {isChat && (
                <button onClick={() => dispatch({ type: 'SET_SETTINGS', settings: { panelOpen: !settings.panelOpen } })}
                  className="px-2 py-1 text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition" title="Ctrl+.">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/></svg>
                </button>
              )}
              {isChat && <button onClick={handleExport} className="hidden md:inline px-2 py-1 text-xs text-gray-400 hover:text-gray-900 dark:hover:text-gray-100" title="Export">&#8595;</button>}
            </div>
          </div>
          {isChat && <StageBar />}
        </header>

        {/* Routes */}
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={
              <ChatArea messages={chat.messages} events={chat.events} isStreaming={chat.sending} disabled={chat.sending}
                onSend={chat.sendMessage} onFeedback={handleFeedback} onInspectEvent={setInspectEvent} />
            } />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/schedules" element={<SchedulesPage />} />
            <Route path="/workflows" element={<WorkflowsPage />} />
            <Route path="/webhooks" element={<WebhooksPage />} />
            <Route path="/logs" element={<LogsPage />} />
          </Routes>
        </Suspense>
      </main>

      {/* Right panel — only on chat page */}
      {isChat && <RightPanel onInspectEvent={setInspectEvent} />}

      {/* Inspector */}
      <Inspector event={inspectEvent} onClose={() => setInspectEvent(null)} />

      {/* Modals */}
      <SettingsModal open={modal === 'settings'} onClose={() => setModal(null)} settings={settings}
        onSave={(s: Settings) => { dispatch({ type: 'SET_SETTINGS', settings: s }); setModal(null); }} />
      <Dashboard open={modal === 'dashboard'} onClose={() => setModal(null)} />
      <Shortcuts open={modal === 'shortcuts'} onClose={() => setModal(null)} />
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}
