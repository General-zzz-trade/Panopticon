import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import type { EventEmitter } from "node:events";
import {
  getOrCreateEmitter,
  hasEmitter,
  getBufferedEvents,
  isClosed
} from "../../streaming/event-bus";
import { requestCancel } from "../run-control";
import { submitJob, getQueue } from "../../worker/pool";

/**
 * Minimal type surface for the `ws` library so we avoid needing @types/ws.
 */
interface WSClient {
  readyState: number;
  send(data: string): void;
  ping(): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  off(event: string, cb: (...args: unknown[]) => void): void;
  once(event: string, cb: (...args: unknown[]) => void): void;
}

interface WSServerLike extends EventEmitter {
  handleUpgrade(
    req: IncomingMessage,
    socket: unknown,
    head: unknown,
    cb: (ws: WSClient) => void
  ): void;
}

interface WSModule {
  WebSocketServer: new (opts: { noServer: boolean }) => WSServerLike;
  OPEN: number;
}

// Dynamic require — ws ships with Playwright / is available at runtime
// eslint-disable-next-line @typescript-eslint/no-var-requires
const wsModule: WSModule = (() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("ws");
  return { WebSocketServer: mod.WebSocketServer, OPEN: mod.WebSocket?.OPEN ?? mod.OPEN ?? 1 };
})();

interface ClientSubscription {
  runId: string;
  onEvent: (event: unknown) => void;
  onClose: () => void;
}

/**
 * Set up a WebSocket endpoint at /api/v1/ws.
 *
 * Uses the `ws` library (available via Playwright dependency tree)
 * attached to the Fastify HTTP server via upgrade handling.
 *
 * Protocol messages (client -> server):
 *   { type: "subscribe", runId: "..." }          — subscribe to run events
 *   { type: "unsubscribe", runId: "..." }        — unsubscribe from run events
 *   { type: "cancel", runId: "..." }             — request run cancellation
 *   { type: "submit", goal: "...", options: {} }  — submit a new run
 *   { type: "ping" }                              — keepalive
 *
 * Server -> client:
 *   { type: "subscribed", runId }
 *   { type: "unsubscribed", runId }
 *   { type: "event", runId, event: {...} }
 *   { type: "run_complete", runId }
 *   { type: "run_submitted", runId }
 *   { type: "cancel_requested", runId }
 *   { type: "error", message }
 *   { type: "pong" }
 */
export function setupWebSocket(app: FastifyInstance): void {
  const wss = new wsModule.WebSocketServer({ noServer: true });
  const clientSubs = new Map<WSClient, Map<string, ClientSubscription>>();

  // Handle upgrade on the Fastify HTTP server
  app.server.on("upgrade", (request: IncomingMessage, socket: unknown, head: unknown) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/api/v1/ws") {
      // Not our endpoint — destroy the socket
      (socket as { destroy(): void }).destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws: WSClient) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: WSClient) => {
    clientSubs.set(ws, new Map());

    // Keepalive ping every 30s
    const pingInterval = setInterval(() => {
      if (ws.readyState === wsModule.OPEN) {
        ws.ping();
      }
    }, 30_000);

    ws.on("message", (raw: unknown) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        sendJSON(ws, { type: "error", message: "Invalid JSON" });
        return;
      }

      const type = msg.type as string;

      switch (type) {
        case "subscribe":
          handleSubscribe(ws, msg.runId as string);
          break;
        case "unsubscribe":
          handleUnsubscribe(ws, msg.runId as string);
          break;
        case "cancel":
          handleCancel(ws, msg.runId as string);
          break;
        case "submit":
          handleSubmit(ws, msg.goal as string, (msg.options ?? {}) as Record<string, unknown>);
          break;
        case "ping":
          sendJSON(ws, { type: "pong" });
          break;
        default:
          sendJSON(ws, { type: "error", message: `Unknown message type: ${type}` });
      }
    });

    ws.on("close", () => {
      cleanup(ws);
      clearInterval(pingInterval);
    });

    ws.on("error", () => {
      cleanup(ws);
      clearInterval(pingInterval);
    });
  });

  function handleSubscribe(ws: WSClient, runId: string): void {
    if (!runId) {
      sendJSON(ws, { type: "error", message: "Missing runId for subscribe" });
      return;
    }

    const subs = clientSubs.get(ws);
    if (!subs) return;

    // Already subscribed
    if (subs.has(runId)) {
      sendJSON(ws, { type: "subscribed", runId, note: "already subscribed" });
      return;
    }

    // Check if run exists
    if (!hasEmitter(runId)) {
      sendJSON(ws, { type: "error", message: `Run not found or completed: ${runId}` });
      return;
    }

    // Replay buffered events
    const buffered = getBufferedEvents(runId, 0);
    for (const event of buffered) {
      sendJSON(ws, { type: "event", runId, event });
    }

    // If already closed, notify and don't subscribe
    if (isClosed(runId)) {
      sendJSON(ws, { type: "run_complete", runId });
      return;
    }

    const emitter = getOrCreateEmitter(runId);

    const onEvent = (event: unknown) => {
      if (ws.readyState === wsModule.OPEN) {
        sendJSON(ws, { type: "event", runId, event });
      }
    };

    const onClose = () => {
      if (ws.readyState === wsModule.OPEN) {
        sendJSON(ws, { type: "run_complete", runId });
      }
      subs.delete(runId);
    };

    emitter.on("event", onEvent);
    emitter.once("close", onClose);

    subs.set(runId, { runId, onEvent, onClose });
    sendJSON(ws, { type: "subscribed", runId });
  }

  function handleUnsubscribe(ws: WSClient, runId: string): void {
    if (!runId) {
      sendJSON(ws, { type: "error", message: "Missing runId for unsubscribe" });
      return;
    }

    const subs = clientSubs.get(ws);
    const sub = subs?.get(runId);
    if (!sub) {
      sendJSON(ws, { type: "unsubscribed", runId, note: "was not subscribed" });
      return;
    }

    removeSub(runId, sub);
    subs!.delete(runId);
    sendJSON(ws, { type: "unsubscribed", runId });
  }

  function handleCancel(ws: WSClient, runId: string): void {
    if (!runId) {
      sendJSON(ws, { type: "error", message: "Missing runId for cancel" });
      return;
    }
    requestCancel(runId);
    sendJSON(ws, { type: "cancel_requested", runId });
  }

  function handleSubmit(
    ws: WSClient,
    goal: string,
    options: Record<string, unknown>
  ): void {
    if (!goal) {
      sendJSON(ws, { type: "error", message: "Missing goal for submit" });
      return;
    }

    const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
    const tenantId = (options.tenantId as string) ?? "default";

    // Ensure the queue is initialized
    getQueue();
    submitJob(runId, goal, options, tenantId);
    sendJSON(ws, { type: "run_submitted", runId });

    // Auto-subscribe to the new run
    handleSubscribe(ws, runId);
  }

  function removeSub(runId: string, sub: ClientSubscription): void {
    if (hasEmitter(runId)) {
      const emitter = getOrCreateEmitter(runId);
      emitter.off("event", sub.onEvent);
      emitter.off("close", sub.onClose);
    }
  }

  function cleanup(ws: WSClient): void {
    const subs = clientSubs.get(ws);
    if (subs) {
      subs.forEach((sub, runId) => {
        removeSub(runId, sub);
      });
      subs.clear();
    }
    clientSubs.delete(ws);
  }
}

function sendJSON(ws: WSClient, data: unknown): void {
  if (ws.readyState === wsModule.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
