/**
 * Structured Logger — wraps pino with module context, run-scoped fields,
 * an in-memory ring buffer for log queries, and a readable stream for
 * live log aggregation.
 */

import pino from "pino";
import { AsyncLocalStorage } from "node:async_hooks";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogEntry {
  timestamp: string;
  module: string;
  level: LogLevel;
  runId: string | null;
  message: string;
  extra: Record<string, unknown>;
}

export interface LogFilter {
  module?: string;
  level?: LogLevel;
  runId?: string;
  since?: string;   // ISO timestamp
  limit?: number;
}

export interface StructuredLogger {
  trace(message: string, extra?: Record<string, unknown>): void;
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
  fatal(message: string, extra?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Async context for runId propagation
// ---------------------------------------------------------------------------

const runContext = new AsyncLocalStorage<{ runId: string }>();

/**
 * Set the runId for all logs within the given async scope.
 * Usage: setRunContext(runId, () => { ... code that logs ... })
 */
export function setRunContext(runId: string): void;
export function setRunContext(runId: string, fn: () => void): void;
export function setRunContext(runId: string, fn?: () => void): void {
  if (fn) {
    runContext.run({ runId }, fn);
  } else {
    // Store globally as fallback when not using async scope
    globalRunId = runId;
  }
}

let globalRunId: string | null = null;

function getCurrentRunId(): string | null {
  return runContext.getStore()?.runId ?? globalRunId;
}

// ---------------------------------------------------------------------------
// Ring buffer for queryable log history
// ---------------------------------------------------------------------------

const BUFFER_SIZE = 1000;
const ringBuffer: LogEntry[] = [];
let bufferPos = 0;
let bufferFull = false;

function pushToBuffer(entry: LogEntry): void {
  if (ringBuffer.length < BUFFER_SIZE) {
    ringBuffer.push(entry);
  } else {
    ringBuffer[bufferPos] = entry;
  }
  bufferPos = (bufferPos + 1) % BUFFER_SIZE;
  if (bufferPos === 0) bufferFull = true;
}

function getBufferEntries(): LogEntry[] {
  if (!bufferFull && ringBuffer.length < BUFFER_SIZE) {
    return [...ringBuffer];
  }
  // Return in chronological order
  return [
    ...ringBuffer.slice(bufferPos),
    ...ringBuffer.slice(0, bufferPos),
  ];
}

// ---------------------------------------------------------------------------
// Live log stream via EventEmitter
// ---------------------------------------------------------------------------

const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(100);

/**
 * Returns a Readable stream that emits newline-delimited JSON log entries
 * as they are produced. Useful for SSE or log aggregation.
 */
export function getLogStream(): Readable {
  const stream = new Readable({
    read() {
      // push-based — data is pushed by the 'log' event handler
    },
  });

  const handler = (entry: LogEntry) => {
    stream.push(JSON.stringify(entry) + "\n");
  };

  logEmitter.on("log", handler);

  stream.on("close", () => {
    logEmitter.off("log", handler);
  });

  return stream;
}

/**
 * Subscribe to live log entries via callback.
 */
export function onLog(handler: (entry: LogEntry) => void): () => void {
  logEmitter.on("log", handler);
  return () => logEmitter.off("log", handler);
}

// ---------------------------------------------------------------------------
// Log query
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Query recent logs from the in-memory ring buffer.
 */
export function queryLogs(filter: LogFilter = {}): LogEntry[] {
  let entries = getBufferEntries();

  if (filter.module) {
    entries = entries.filter((e) => e.module === filter.module);
  }
  if (filter.level) {
    const minLevel = LEVEL_ORDER[filter.level] ?? 0;
    entries = entries.filter((e) => (LEVEL_ORDER[e.level] ?? 0) >= minLevel);
  }
  if (filter.runId) {
    entries = entries.filter((e) => e.runId === filter.runId);
  }
  if (filter.since) {
    entries = entries.filter((e) => e.timestamp >= filter.since!);
  }

  const limit = filter.limit ?? 100;
  // Return most recent entries first
  return entries.slice(-limit).reverse();
}

// ---------------------------------------------------------------------------
// Base pino instance
// ---------------------------------------------------------------------------

const basePino = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// ---------------------------------------------------------------------------
// createLogger — main API
// ---------------------------------------------------------------------------

/**
 * Create a structured logger scoped to a module name.
 * Each log line automatically includes timestamp, module, runId, and extra fields.
 */
export function createLogger(module: string): StructuredLogger {
  const child = basePino.child({ module });

  function log(level: LogLevel, message: string, extra: Record<string, unknown> = {}): void {
    const runId = getCurrentRunId();
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      module,
      level,
      runId,
      message,
      extra,
    };

    // Push to ring buffer
    pushToBuffer(entry);

    // Emit for live stream consumers
    logEmitter.emit("log", entry);

    // Write to pino
    const pinoExtra = { ...extra, runId };
    child[level](pinoExtra, message);
  }

  return {
    trace: (msg, extra) => log("trace", msg, extra),
    debug: (msg, extra) => log("debug", msg, extra),
    info: (msg, extra) => log("info", msg, extra),
    warn: (msg, extra) => log("warn", msg, extra),
    error: (msg, extra) => log("error", msg, extra),
    fatal: (msg, extra) => log("fatal", msg, extra),
  };
}
