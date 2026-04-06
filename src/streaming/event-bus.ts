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
  | "dialogue_requested"
  | "observation"
  | "hypothesis"
  | "decision"
  | "planning"
  | "thinking";

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
  /** Monotonic sequence id per run, injected by publishEvent */
  seq?: number;
}

const BUFFER_SIZE = Number(process.env.EVENT_BUFFER_SIZE ?? 500);
const RETAIN_AFTER_CLOSE_MS = Number(process.env.EVENT_RETAIN_MS ?? 60_000);

interface RunBus {
  emitter: EventEmitter;
  buffer: ExecutionEvent[];
  seq: number;
  closed: boolean;
  closedAt?: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

// One bus per runId — retains buffer briefly after close so late subscribers can replay
const buses = new Map<string, RunBus>();

function getBus(runId: string): RunBus {
  let bus = buses.get(runId);
  if (!bus) {
    bus = { emitter: new EventEmitter(), buffer: [], seq: 0, closed: false };
    bus.emitter.setMaxListeners(50);
    buses.set(runId, bus);
  }
  return bus;
}

export function getOrCreateEmitter(runId: string): EventEmitter {
  return getBus(runId).emitter;
}

export function publishEvent(event: ExecutionEvent): void {
  const bus = getBus(event.runId);
  bus.seq += 1;
  const stamped: ExecutionEvent = { ...event, seq: bus.seq };
  bus.buffer.push(stamped);
  if (bus.buffer.length > BUFFER_SIZE) bus.buffer.shift();
  bus.emitter.emit("event", stamped);
}

/** Retrieve buffered events with seq > sinceSeq (for Last-Event-ID replay). */
export function getBufferedEvents(runId: string, sinceSeq = 0): ExecutionEvent[] {
  const bus = buses.get(runId);
  if (!bus) return [];
  return bus.buffer.filter(e => (e.seq ?? 0) > sinceSeq);
}

/** Has the run finished (close event fired)? */
export function isClosed(runId: string): boolean {
  const bus = buses.get(runId);
  return bus?.closed ?? false;
}

export function closeEmitter(runId: string): void {
  const bus = buses.get(runId);
  if (!bus) return;
  if (bus.closed) return;
  bus.closed = true;
  bus.closedAt = Date.now();
  bus.emitter.emit("close");
  // Retain buffer briefly so late-arriving stream subscribers can still replay
  bus.cleanupTimer = setTimeout(() => {
    bus.emitter.removeAllListeners();
    buses.delete(runId);
  }, RETAIN_AFTER_CLOSE_MS);
}

/** Pre-register a bus so stream subscribers find it before the first event is published. */
export function ensureBus(runId: string): void {
  getBus(runId);
}

export function hasEmitter(runId: string): boolean {
  return buses.has(runId);
}
