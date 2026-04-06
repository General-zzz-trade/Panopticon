import React, { useRef, useEffect, useCallback } from 'react';
import type { Message, AgentEvent, Attachment } from '../types';
import { MessageBubble } from './MessageBubble';
import { InputComposer } from './InputComposer';

const SUGGESTIONS = [
  { label: 'Read a webpage',   text: 'Go to ' },
  { label: 'Analyze a project', text: 'Search for ' },
  { label: 'Call an API',       text: 'Fetch ' },
  { label: 'Browse the web',    text: 'Go to https://' },
];

interface ChatAreaProps {
  messages: Message[];
  events: AgentEvent[];
  isStreaming?: boolean;
  streamingContent?: string;
  streamingRunId?: string;
  history?: string[];
  disabled?: boolean;
  onSend: (text: string, attachments?: Attachment[]) => void;
  onEdit?: (messageId: string, content: string) => void;
  onFork?: (messageId: string) => void;
  onFeedback?: (messageId: string, rating: 'up' | 'down') => void;
  onRetry?: (messageId: string) => void;
  onInspectEvent?: (event: AgentEvent) => void;
}

export function ChatArea({
  messages,
  events,
  isStreaming = false,
  streamingContent,
  streamingRunId,
  history = [],
  disabled = false,
  onSend,
  onEdit,
  onFork,
  onFeedback,
  onRetry,
  onInspectEvent,
}: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when messages change or streaming content updates
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, streamingContent, scrollToBottom]);

  const isEmpty = messages.length === 0 && !isStreaming;

  const handleSuggestionClick = (text: string) => {
    onSend(text);
  };

  const eventsForRun = (runId?: string): AgentEvent[] => {
    if (!runId) return [];
    return events.filter((e) => e.runId === runId);
  };

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      {/* Scrollable messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {isEmpty ? (
          /* Empty state */
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600">
              <svg
                className="h-8 w-8 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <h2 className="mb-2 text-xl font-semibold text-gray-800 dark:text-gray-200">
              How can I help today?
            </h2>
            <p className="mb-6 max-w-md text-sm text-gray-500 dark:text-gray-400">
              Browse websites, run commands, call APIs, and automate tasks.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-sm text-gray-700 shadow-sm transition hover:border-blue-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-600"
                  onClick={() => handleSuggestionClick(s.text)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Message list */
          <div className="mx-auto max-w-3xl space-y-1">
            {messages.map((msg, idx) => {
              const isLastAssistant =
                msg.role === 'assistant' &&
                idx === messages.length - 1 &&
                isStreaming &&
                msg.runId === streamingRunId;

              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  events={eventsForRun(msg.runId)}
                  isStreaming={isLastAssistant}
                  streamingContent={isLastAssistant ? streamingContent : undefined}
                  onEdit={onEdit ? (content) => onEdit(msg.id, content) : undefined}
                  onFork={onFork ? () => onFork(msg.id) : undefined}
                  onFeedback={
                    msg.role === 'assistant' && onFeedback
                      ? (rating) => onFeedback(msg.id, rating)
                      : undefined
                  }
                  onRetry={
                    msg.role === 'assistant' && msg.success === false && onRetry
                      ? () => onRetry(msg.id)
                      : undefined
                  }
                  onInspectEvent={onInspectEvent}
                />
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <InputComposer onSend={onSend} disabled={disabled || isStreaming} history={history} />
    </main>
  );
}
