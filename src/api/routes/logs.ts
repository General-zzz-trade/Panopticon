/**
 * Logs API routes — query recent structured logs and stream live logs via SSE.
 */

import type { FastifyInstance } from "fastify";
import { queryLogs, onLog, type LogLevel, type LogEntry } from "../../observability/structured-logger";

export async function logsRoutes(app: FastifyInstance): Promise<void> {
  // GET /logs — query recent logs with filters
  app.get<{
    Querystring: {
      module?: string;
      level?: string;
      runId?: string;
      limit?: string;
      since?: string;
    };
  }>("/logs", async (request, reply) => {
    const { module, level, runId, limit, since } = request.query;

    const validLevels = ["trace", "debug", "info", "warn", "error", "fatal"];
    const filterLevel = level && validLevels.includes(level) ? (level as LogLevel) : undefined;

    const entries = queryLogs({
      module,
      level: filterLevel,
      runId,
      since,
      limit: limit ? Math.min(parseInt(limit, 10) || 100, 1000) : 100,
    });

    return reply.send({ logs: entries, count: entries.length });
  });

  // GET /logs/stream — SSE stream of live logs
  app.get<{
    Querystring: {
      module?: string;
      level?: string;
      runId?: string;
    };
  }>("/logs/stream", async (request, reply) => {
    const { module, level, runId } = request.query;

    const validLevels = ["trace", "debug", "info", "warn", "error", "fatal"];
    const filterLevel = level && validLevels.includes(level) ? (level as LogLevel) : undefined;

    const LEVEL_ORDER: Record<LogLevel, number> = {
      trace: 10,
      debug: 20,
      info: 30,
      warn: 40,
      error: 50,
      fatal: 60,
    };

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    const sendEvent = (entry: LogEntry) => {
      reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`);
    };

    // Send a keep-alive comment every 15 seconds
    const keepAlive = setInterval(() => {
      reply.raw.write(": keepalive\n\n");
    }, 15_000);

    const unsubscribe = onLog((entry) => {
      // Apply filters
      if (module && entry.module !== module) return;
      if (filterLevel && (LEVEL_ORDER[entry.level] ?? 0) < (LEVEL_ORDER[filterLevel] ?? 0)) return;
      if (runId && entry.runId !== runId) return;

      sendEvent(entry);
    });

    // Clean up on client disconnect
    request.raw.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
      reply.raw.end();
    });
  });
}
