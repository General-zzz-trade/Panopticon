import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import type { AgentEvent } from '../types';

type Tab = 'live' | 'artifacts' | 'trace';

const TAB_LABELS: { key: Tab; label: string }[] = [
  { key: 'live', label: 'Live' },
  { key: 'artifacts', label: 'Artifacts' },
  { key: 'trace', label: 'Trace' },
];

function eventIcon(type: string): string {
  switch (type) {
    case 'task:start': return '\u25B6';
    case 'task:done': return '\u2714';
    case 'task:fail': return '\u2718';
    case 'screenshot': return '\uD83D\uDCF7';
    case 'plan': return '\uD83D\uDCCB';
    case 'verify': return '\uD83D\uDD0D';
    case 'replan': return '\uD83D\uDD04';
    default: return '\u25CF';
  }
}

function eventColor(type: string): string {
  if (type.includes('fail') || type.includes('error')) return 'text-red-400';
  if (type.includes('done') || type.includes('success')) return 'text-green-400';
  if (type.includes('start')) return 'text-blue-400';
  if (type.includes('plan')) return 'text-purple-400';
  if (type.includes('verify')) return 'text-yellow-400';
  return 'text-gray-400';
}

interface RightPanelProps {
  onInspectEvent?: (event: AgentEvent) => void;
}

export function RightPanel({ onInspectEvent }: RightPanelProps) {
  const { state } = useApp();
  const { events, settings } = state;
  const [tab, setTab] = useState<Tab>('live');
  const [width, setWidth] = useState(384);
  const resizing = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  // Latest screenshot from events
  const latestScreenshot = [...events]
    .reverse()
    .find((e) => e.screenshotDataUrl)?.screenshotDataUrl ?? null;

  // Artifacts from events
  const artifacts = events.filter(
    (e) => e.payload?.artifactPath || e.screenshotDataUrl,
  );

  // Browser URL bar state
  const [browserUrl, setBrowserUrl] = useState('');

  // Resize handling
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      resizing.current = true;
      startX.current = e.clientX;
      startW.current = width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width],
  );

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!resizing.current) return;
      const delta = startX.current - e.clientX;
      setWidth(Math.max(280, Math.min(800, startW.current + delta)));
    }
    function onMouseUp() {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const isOpen = settings.panelOpen;

  return (
    <>
      {/* Resize handle */}
      <div
        className={`resize-handle ${isOpen ? '' : 'panel-hidden'}`}
        onMouseDown={onMouseDown}
      />

      <aside
        className={`right-panel flex flex-col bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 ${
          isOpen ? 'open' : 'collapsed'
        }`}
        style={{ width: isOpen ? width : 0, minWidth: isOpen ? 280 : 0 }}
      >
        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          {TAB_LABELS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 px-3 py-2 text-xs font-medium transition ${
                tab === t.key
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto scroll-thin">
          {tab === 'live' && (
            <LiveTab screenshot={latestScreenshot} browserUrl={browserUrl} setBrowserUrl={setBrowserUrl} />
          )}
          {tab === 'artifacts' && <ArtifactsTab artifacts={artifacts} />}
          {tab === 'trace' && (
            <TraceTab events={events} onInspect={onInspectEvent} />
          )}
        </div>
      </aside>
    </>
  );
}

/* ── Live Tab ───────────────────────────────────────────────── */

function LiveTab({
  screenshot,
  browserUrl,
  setBrowserUrl,
}: {
  screenshot: string | null;
  browserUrl: string;
  setBrowserUrl: (u: string) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex items-center justify-center p-4">
        {screenshot ? (
          <img
            src={screenshot}
            alt="Browser screenshot"
            className="max-w-full rounded-lg shadow-md border border-gray-200 dark:border-gray-700"
          />
        ) : (
          <div className="text-center text-gray-400">
            <svg
              className="w-16 h-16 mx-auto mb-3 opacity-30"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            <p className="text-sm">No browser session active</p>
            <p className="text-xs mt-1 text-gray-500">
              Start a run to see live browser view
            </p>
          </div>
        )}
      </div>

      {/* Browser control bar */}
      <div className="border-t border-gray-200 dark:border-gray-800 px-3 py-2 flex items-center gap-1.5 flex-shrink-0">
        <button
          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-sm"
          title="Back"
        >
          &larr;
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-sm"
          title="Forward"
        >
          &rarr;
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-sm"
          title="Refresh"
        >
          &#8635;
        </button>
        <input
          type="text"
          value={browserUrl}
          onChange={(e) => setBrowserUrl(e.target.value)}
          placeholder="URL"
          className="flex-1 px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 dark:bg-gray-900 rounded focus:outline-none focus:border-blue-500"
        />
        <button
          className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition"
          title="Navigate"
        >
          Go
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-sm"
          title="Screenshot"
        >
          &#128247;
        </button>
      </div>
    </div>
  );
}

/* ── Artifacts Tab ──────────────────────────────────────────── */

function ArtifactsTab({ artifacts }: { artifacts: AgentEvent[] }) {
  if (artifacts.length === 0) {
    return (
      <div className="p-6 text-center text-gray-400 text-sm">
        <p>No artifacts yet</p>
        <p className="text-xs mt-1 text-gray-500">
          Screenshots and files will appear here during runs
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {artifacts.map((a, i) => {
        const path = (a.payload?.artifactPath as string) ?? '';
        const isImage =
          a.screenshotDataUrl ||
          /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(path);

        return (
          <div
            key={`${a.runId}-${a.seq ?? i}`}
            className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden"
          >
            {isImage && a.screenshotDataUrl ? (
              <img
                src={a.screenshotDataUrl}
                alt={a.summary ?? 'Artifact'}
                className="w-full"
              />
            ) : (
              <pre className="p-3 text-xs bg-gray-50 dark:bg-gray-900 overflow-x-auto mono">
                {a.content ?? path ?? JSON.stringify(a.payload, null, 2)}
              </pre>
            )}
            <div className="px-3 py-1.5 text-xs text-gray-500 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
              {a.summary ?? path ?? a.type}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Trace Tab ──────────────────────────────────────────────── */

function TraceTab({
  events,
  onInspect,
}: {
  events: AgentEvent[];
  onInspect?: (event: AgentEvent) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events.length]);

  if (events.length === 0) {
    return (
      <div className="p-6 text-center text-gray-400 text-sm">
        <p>No events yet</p>
        <p className="text-xs mt-1 text-gray-500">
          Events will stream in during active runs
        </p>
      </div>
    );
  }

  return (
    <div ref={listRef} className="p-2">
      {events.map((ev, i) => (
        <div
          key={`${ev.runId}-${ev.seq ?? i}`}
          className="event-row flex items-start gap-2 py-1.5 px-2 text-xs"
          onClick={() => onInspect?.(ev)}
        >
          <span className={`${eventColor(ev.type)} flex-shrink-0 mt-0.5`}>
            {eventIcon(ev.type)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-gray-700 dark:text-gray-300 truncate">
              {ev.summary ?? ev.type}
            </div>
            {ev.message && (
              <div className="text-gray-500 truncate">{ev.message}</div>
            )}
          </div>
          {ev.durationMs != null && (
            <span className="text-gray-400 flex-shrink-0 mono">
              {ev.durationMs}ms
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
