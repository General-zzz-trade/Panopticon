import type { AgentEvent } from '../types';

interface InspectorProps {
  event: AgentEvent | null;
  onClose: () => void;
}

export function Inspector({ event, onClose }: InspectorProps) {
  if (!event) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="drawer open fixed top-0 right-0 bottom-0 w-[420px] max-w-full bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <h3 className="font-semibold text-sm truncate">
            {event.summary ?? event.type}
          </h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition"
            title="Close"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-4 text-sm">
          {/* Summary */}
          {event.summary && (
            <Section label="Summary">
              <p className="text-gray-700 dark:text-gray-300">{event.summary}</p>
            </Section>
          )}

          {/* Message */}
          {event.message && (
            <Section label="Message">
              <p className="text-gray-600 dark:text-gray-400">{event.message}</p>
            </Section>
          )}

          {/* Meta row */}
          <div className="grid grid-cols-2 gap-3">
            <MetaItem label="Event type" value={event.type} />
            {event.taskType && (
              <MetaItem label="Task type" value={event.taskType} />
            )}
            {event.durationMs != null && (
              <MetaItem label="Duration" value={`${event.durationMs}ms`} />
            )}
            {event.seq != null && (
              <MetaItem label="Sequence" value={`#${event.seq}`} />
            )}
            <MetaItem label="Run ID" value={event.runId} mono />
          </div>

          {/* Timestamp */}
          <Section label="Timestamp">
            <p className="mono text-xs text-gray-500">
              {new Date(event.timestamp).toLocaleString()}
            </p>
          </Section>

          {/* Error */}
          {event.error && (
            <Section label="Error">
              <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-lg p-3 text-red-700 dark:text-red-300 text-xs mono whitespace-pre-wrap">
                {event.error}
              </div>
            </Section>
          )}

          {/* Success status */}
          {event.success != null && (
            <Section label="Result">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                  event.success
                    ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                    : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                }`}
              >
                {event.success ? '\u2714 Success' : '\u2718 Failed'}
              </span>
            </Section>
          )}

          {/* Screenshot */}
          {event.screenshotDataUrl && (
            <Section label="Screenshot">
              <img
                src={event.screenshotDataUrl}
                alt="Screenshot"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700"
              />
            </Section>
          )}

          {/* Payload */}
          {event.payload && Object.keys(event.payload).length > 0 && (
            <Section label="Payload">
              <pre className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 text-xs mono overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </Section>
          )}

          {/* Content */}
          {event.content && (
            <Section label="Content">
              <pre className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 text-xs mono overflow-x-auto whitespace-pre-wrap">
                {event.content}
              </pre>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}

function MetaItem({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
      <div
        className={`text-gray-700 dark:text-gray-300 text-xs truncate ${
          mono ? 'mono' : ''
        }`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
