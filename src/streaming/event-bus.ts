import { EventEmitter } from "node:events";

export type ExecutionEventType =
  | "task_start"
  | "task_done"
  | "task_failed"
  | "screenshot"
  | "replan"
  | "log"
  | "run_complete"
  | "approval_required"
  | "help_requested"
  | "dialogue_requested";

export interface ExecutionEvent {
  type: ExecutionEventType;
  runId: string;
  timestamp: string;
  taskId?: string;
  taskType?: string;
  payload?: Record<string, unknown>;
  summary?: string;
  durationMs?: number;
  error?: string;
  screenshotDataUrl?: string;    // base64 data URL for screenshot events
  message?: string;
  success?: boolean;
}

// One emitter per runId, auto-cleaned when run completes
const emitters = new Map<string, EventEmitter>();

export function getOrCreateEmitter(runId: string): EventEmitter {
  if (!emitters.has(runId)) {
    emitters.set(runId, new EventEmitter());
  }
  return emitters.get(runId)!;
}

export function publishEvent(event: ExecutionEvent): void {
  const emitter = emitters.get(event.runId);
  emitter?.emit("event", event);
}

export function closeEmitter(runId: string): void {
  const emitter = emitters.get(runId);
  if (emitter) {
    emitters.delete(runId);
    emitter.emit("close");
    emitter.removeAllListeners();
  }
}

export function hasEmitter(runId: string): boolean {
  return emitters.has(runId);
}
