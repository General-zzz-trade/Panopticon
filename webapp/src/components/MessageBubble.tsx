import React, { useState } from 'react';
import type { Message, AgentEvent, Attachment } from '../types';
import { Markdown } from './Markdown';
import { Lightbox } from './Lightbox';

/** Map event type to display metadata */
const EVT_META: Record<string, { icon: string; label: string; color: string }> = {
  planning:   { icon: '\u25c7', label: 'Planning',    color: 'text-indigo-500' },
  task_start: { icon: '\u25b6', label: 'Start',       color: 'text-blue-500' },
  task_done:  { icon: '\u2713', label: 'Done',        color: 'text-green-500' },
  task_failed:{ icon: '\u2717', label: 'Failed',      color: 'text-red-500' },
  observation:{ icon: '\u25c9', label: 'Observe',     color: 'text-gray-500' },
  hypothesis: { icon: '?',     label: 'Hypothesis',  color: 'text-amber-500' },
  replan:     { icon: '\u21bb', label: 'Replan',      color: 'text-purple-500' },
  decision:   { icon: '\u25cf', label: 'Decide',      color: 'text-gray-500' },
  screenshot: { icon: '\ud83d\udcf7', label: 'Screen', color: 'text-gray-500' },
};

const KEY_EVENT_TYPES = new Set([
  'planning', 'task_start', 'task_done', 'task_failed', 'hypothesis', 'replan',
]);

interface MessageBubbleProps {
  message: Message;
  events?: AgentEvent[];
  isStreaming?: boolean;
  streamingContent?: string;
  onEdit?: (content: string) => void;
  onFork?: () => void;
  onFeedback?: (rating: 'up' | 'down') => void;
  onRetry?: () => void;
  onInspectEvent?: (event: AgentEvent) => void;
}

function fmtTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function MessageBubble({
  message,
  events = [],
  isStreaming = false,
  streamingContent,
  onEdit,
  onFork,
  onFeedback,
  onRetry,
  onInspectEvent,
}: MessageBubbleProps) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(isStreaming);
  const [feedbackGiven, setFeedbackGiven] = useState<'up' | 'down' | null>(null);

  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <>
        <div className="group mb-3 flex justify-end gap-2">
          <div className="max-w-[75%] text-right">
            <div className="inline-block text-left rounded-2xl bg-gray-100 px-4 py-3 text-sm dark:bg-gray-800">
              <Markdown content={message.content} />
              {/* Attachment thumbnails */}
              {message.attachments && message.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {message.attachments.map((att, i) =>
                    att.type.startsWith('image/') ? (
                      <img
                        key={i}
                        src={att.dataUrl}
                        alt={att.name}
                        className="max-w-[8rem] cursor-pointer rounded"
                        loading="lazy"
                        onClick={() => setLightboxSrc(att.dataUrl)}
                      />
                    ) : (
                      <span key={i} className="text-xs text-gray-500">
                        \ud83d\udcc4 {att.name}
                      </span>
                    ),
                  )}
                </div>
              )}
            </div>
            {/* Hover actions */}
            <div className="mt-0.5 mr-1 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              {onEdit && (
                <button
                  className="text-gray-400 hover:text-blue-600"
                  title="Edit & resend"
                  onClick={() => onEdit(message.content)}
                >
                  \u270e
                </button>
              )}
              {onFork && (
                <button
                  className="text-gray-400 hover:text-purple-600"
                  title="Branch from here"
                  onClick={onFork}
                >
                  \u2442
                </button>
              )}
              <span className="text-[10px] text-gray-400">{fmtTime(message.timestamp)}</span>
            </div>
          </div>
        </div>
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      </>
    );
  }

  // --- Assistant bubble ---
  const displayContent = isStreaming ? (streamingContent ?? '') : message.content;
  const isFailed = message.success === false;
  const inlineEvents = events.filter((e) => KEY_EVENT_TYPES.has(e.type));
  const stepCount = events.length;

  return (
    <div className="group mb-3 flex gap-3">
      {/* Avatar */}
      <div
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600"
        title="Agent"
      >
        <svg
          className="h-4 w-4 text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      </div>

      <div className="min-w-0 flex-1">
        {/* Collapsible working steps */}
        {events.length > 0 && (
          <details
            className="mb-2"
            open={detailsOpen}
            onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="mb-1 inline-flex cursor-pointer items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
              <span>
                {isFailed ? '\u2717' : isStreaming ? 'Working' : '\u2713'} \u00b7 {stepCount} step
                {stepCount !== 1 ? 's' : ''}
              </span>
              <span className="text-gray-400">\u25be</span>
            </summary>
            <div className="ml-1 space-y-0.5 rounded-r border-l-2 border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/50">
              {events.map((evt, i) => {
                const meta = EVT_META[evt.type] || { icon: '\u25cf', label: evt.type, color: 'text-gray-500' };
                const text = evt.summary || evt.message || evt.taskType || evt.type;
                return (
                  <div
                    key={i}
                    className="flex cursor-pointer items-start gap-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 py-0.5"
                    onClick={() => onInspectEvent?.(evt)}
                  >
                    <span className={`w-4 flex-shrink-0 font-mono ${meta.color}`}>{meta.icon}</span>
                    <span className="w-14 flex-shrink-0 text-gray-400">{meta.label}</span>
                    <span className="flex-1 truncate text-gray-700 dark:text-gray-300">
                      {String(text).slice(0, 200)}
                    </span>
                    {evt.durationMs != null && (
                      <span className="flex-shrink-0 text-gray-400">
                        {(evt.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        )}

        {/* Inline event cards for key events */}
        {inlineEvents.length > 0 && !detailsOpen && (
          <div className="mb-2 space-y-1">
            {inlineEvents.slice(-6).map((evt, i) => {
              const meta = EVT_META[evt.type] || { icon: '\u25cf', label: evt.type, color: 'text-gray-500' };
              const text = evt.summary || evt.message || evt.taskType || evt.type;
              return (
                <div
                  key={i}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-1.5 text-xs cursor-pointer dark:border-gray-800 dark:bg-gray-900/50 mr-1"
                  onClick={() => onInspectEvent?.(evt)}
                >
                  <span className={`font-mono ${meta.color}`}>{meta.icon}</span>
                  <span className="font-medium text-gray-600 dark:text-gray-300">{meta.label}</span>
                  <span className="max-w-[20rem] truncate text-gray-500 dark:text-gray-400">
                    {String(text).slice(0, 120)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Typing indicator */}
        {isStreaming && !displayContent && (
          <div className="mb-2 flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
          </div>
        )}

        {/* Response content */}
        {displayContent && (
          <div className="text-sm">
            <Markdown content={displayContent} streaming={isStreaming} />
          </div>
        )}

        {/* Error banner with retry */}
        {isFailed && !isStreaming && (
          <div
            className="mt-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400"
            role="alert"
          >
            <span>\u26a0</span>
            <span className="flex-1">Task failed</span>
            {onRetry && (
              <button
                className="rounded border border-red-300 px-2 py-0.5 transition hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900"
                onClick={onRetry}
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* Hover actions: feedback, fork, timestamp */}
        {!isStreaming && (
          <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {onFeedback && (
              <>
                <button
                  className={
                    feedbackGiven === 'up'
                      ? 'text-green-600'
                      : 'text-gray-400 hover:text-green-600'
                  }
                  title="Good response"
                  onClick={() => {
                    setFeedbackGiven('up');
                    onFeedback('up');
                  }}
                >
                  \ud83d\udc4d
                </button>
                <button
                  className={
                    feedbackGiven === 'down'
                      ? 'text-red-600'
                      : 'text-gray-400 hover:text-red-600'
                  }
                  title="Bad response"
                  onClick={() => {
                    setFeedbackGiven('down');
                    onFeedback('down');
                  }}
                >
                  \ud83d\udc4e
                </button>
              </>
            )}
            {onFork && (
              <button
                className="text-gray-400 hover:text-purple-600"
                title="Branch from here"
                onClick={onFork}
              >
                \u2442
              </button>
            )}
            <span className="text-[10px] text-gray-400">{fmtTime(message.timestamp)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
