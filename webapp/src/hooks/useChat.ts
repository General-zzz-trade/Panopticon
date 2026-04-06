import { useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import type { Attachment, AgentEvent, Message } from '../types';
import * as api from '../api/client';

// ── Stage mapping (mirrors public/app.js eventToStage) ────────

function eventToStage(
  eventType: string,
): 'planning' | 'executing' | 'verifying' | 'done' | null {
  if (eventType === 'planning') return 'planning';
  if (
    eventType === 'task_start' ||
    eventType === 'observation' ||
    eventType === 'hypothesis' ||
    eventType === 'replan'
  )
    return 'executing';
  if (
    eventType === 'task_done' ||
    eventType === 'task_failed' ||
    eventType === 'decision'
  )
    return 'verifying';
  if (eventType === 'run_complete') return 'done';
  return null;
}

function makeId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useChat() {
  const { state, dispatch } = useApp();
  const eventSourceRef = useRef<EventSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Close any existing SSE / stream ────────────────────────

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  // ── Handle SSE stream from /chat endpoint (chat_chunk events) ─

  const readChatStream = useCallback(
    async (response: Response) => {
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === '[DONE]') continue;

            try {
              const evt = JSON.parse(raw);

              if (evt.type === 'chat_chunk' && evt.content) {
                dispatch({ type: 'UPDATE_LAST_MESSAGE', content: evt.content });
              } else if (evt.type === 'chat_done') {
                dispatch({
                  type: 'FINISH_MESSAGE',
                  success: evt.success !== false,
                });
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }

        // If stream ended without chat_done, finish anyway
        dispatch({ type: 'FINISH_MESSAGE', success: true });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          dispatch({
            type: 'UPDATE_LAST_MESSAGE',
            content: '\n\n[Stream error]',
            done: true,
          });
          dispatch({ type: 'FINISH_MESSAGE', success: false });
        }
      }
    },
    [dispatch],
  );

  // ── Handle task-mode SSE via EventSource ────────────────────

  const connectRunEvents = useCallback(
    (runId: string) => {
      cleanup();

      dispatch({ type: 'SET_RUN_ID', runId });
      dispatch({ type: 'SET_STAGE', stage: 'planning' });

      const es = api.connectSSE(runId);
      eventSourceRef.current = es;

      es.onmessage = (e) => {
        try {
          const evt: AgentEvent = JSON.parse(e.data);

          dispatch({ type: 'ADD_EVENT', event: evt });

          // Update stage
          const stage = eventToStage(evt.type);
          if (stage) {
            dispatch({ type: 'SET_STAGE', stage });
          }

          // Track task progress
          if (evt.type === 'task_start') {
            dispatch({
              type: 'SET_TASKS_TOTAL',
              total: state.tasksTotal + 1,
            });
          }
          if (evt.type === 'task_done' || evt.type === 'task_failed') {
            dispatch({ type: 'INCREMENT_TASKS_DONE' });
          }

          // Accumulate summary into assistant message
          if (evt.summary) {
            dispatch({
              type: 'UPDATE_LAST_MESSAGE',
              content: evt.summary,
            });
          }

          // Run complete: finalize
          if (evt.type === 'run_complete') {
            const content = evt.summary || (evt.success ? 'Task completed successfully.' : 'Task failed.');
            // Replace accumulated content with final summary
            dispatch({
              type: 'FINISH_MESSAGE',
              success: evt.success,
            });
            es.close();
            eventSourceRef.current = null;
          }

          // Handle not-found / error
          if (evt.type === 'run_not_found_or_complete') {
            dispatch({ type: 'FINISH_MESSAGE', success: false });
            es.close();
            eventSourceRef.current = null;
          }
        } catch {
          // skip malformed
        }
      };

      es.onerror = () => {
        dispatch({ type: 'FINISH_MESSAGE', success: false });
        es.close();
        eventSourceRef.current = null;
      };
    },
    [cleanup, dispatch, state.tasksTotal],
  );

  // ── Send message ────────────────────────────────────────────

  const sendMessage = useCallback(
    async (text: string, attachments?: Attachment[]) => {
      if (state.sending || !text.trim()) return;

      cleanup();

      dispatch({ type: 'SET_SENDING', sending: true });
      dispatch({ type: 'SET_STAGE', stage: 'idle' });

      // Add user message
      const userMsg: Message = {
        id: makeId(),
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
        attachments,
      };
      dispatch({ type: 'ADD_MESSAGE', message: userMsg });

      // Add empty assistant message placeholder
      const assistantMsg: Message = {
        id: makeId(),
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_MESSAGE', message: assistantMsg });

      try {
        const abortController = new AbortController();
        abortRef.current = abortController;

        const response = await api.sendChat(
          text,
          state.activeConvoId ?? undefined,
          { signal: abortController.signal } as any,
        );

        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('text/event-stream')) {
          // Chat mode: streaming SSE from /chat endpoint
          await readChatStream(response);
        } else {
          // Task mode: JSON with runId
          const data = await response.json();

          if (data.type === 'chat' && data.message) {
            // Direct chat response (no LLM streaming)
            dispatch({
              type: 'UPDATE_LAST_MESSAGE',
              content: data.message,
              done: true,
            });
            dispatch({ type: 'FINISH_MESSAGE', success: true });
          } else if (data.runId) {
            // Task submitted — connect to run event stream
            assistantMsg.runId = data.runId;
            connectRunEvents(data.runId);
          } else {
            dispatch({
              type: 'UPDATE_LAST_MESSAGE',
              content: data.message || 'Request submitted.',
              done: true,
            });
            dispatch({ type: 'FINISH_MESSAGE', success: true });
          }
        }
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : 'Unknown error';
        dispatch({
          type: 'UPDATE_LAST_MESSAGE',
          content: `Error: ${errMsg}`,
          done: true,
        });
        dispatch({ type: 'FINISH_MESSAGE', success: false });
      }
    },
    [
      state.sending,
      state.activeConvoId,
      cleanup,
      dispatch,
      readChatStream,
      connectRunEvents,
    ],
  );

  // ── Load existing conversation ──────────────────────────────

  const loadConversation = useCallback(
    async (id: string) => {
      cleanup();

      dispatch({ type: 'SET_ACTIVE_CONVO', id });
      dispatch({ type: 'SET_STAGE', stage: 'idle' });
      dispatch({ type: 'SET_RUN_ID', runId: null });

      try {
        const convo = await api.getConversation(id);
        const messages: Message[] = [];

        if (convo.turns) {
          for (const turn of convo.turns) {
            if (turn.goal) {
              messages.push({
                id: makeId(),
                role: 'user',
                content: turn.goal,
                timestamp: turn.startedAt || new Date().toISOString(),
              });
            }
            if (turn.summary) {
              messages.push({
                id: makeId(),
                role: 'assistant',
                content: turn.summary,
                timestamp: turn.endedAt || new Date().toISOString(),
                runId: turn.runId,
                success: turn.success,
              });
            }
          }
        }

        dispatch({ type: 'SET_MESSAGES', messages });
      } catch {
        dispatch({ type: 'SET_MESSAGES', messages: [] });
      }
    },
    [cleanup, dispatch],
  );

  // ── New chat ────────────────────────────────────────────────

  const newChat = useCallback(() => {
    cleanup();
    dispatch({ type: 'NEW_CHAT' });
  }, [cleanup, dispatch]);

  return {
    messages: state.messages,
    sending: state.sending,
    stage: state.stage,
    events: state.events,
    runId: state.runId,
    tasksDone: state.tasksDone,
    tasksTotal: state.tasksTotal,
    sendMessage,
    loadConversation,
    newChat,
  };
}
