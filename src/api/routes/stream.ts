import type { FastifyInstance } from "fastify";
import { getOrCreateEmitter, hasEmitter, getBufferedEvents, isClosed } from "../../streaming/event-bus";

export async function streamRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/runs/:id/stream", async (request, reply) => {
    const { id } = request.params;

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });

    const sendEvent = (data: unknown, seq?: number) => {
      const idLine = seq != null ? `id: ${seq}\n` : "";
      reply.raw.write(`${idLine}data: ${JSON.stringify(data)}\n\n`);
    };

    // Parse Last-Event-ID for replay (from header or query param)
    const headerId = request.headers["last-event-id"];
    const queryId = (request.query as { lastEventId?: string })?.lastEventId;
    const sinceSeq = Number(Array.isArray(headerId) ? headerId[0] : headerId ?? queryId ?? 0) || 0;

    // No bus at all — run never existed or was evicted
    if (!hasEmitter(id)) {
      sendEvent({ type: "run_not_found_or_complete", runId: id });
      reply.raw.end();
      return;
    }

    // Replay any buffered events the client hasn't seen
    const missed = getBufferedEvents(id, sinceSeq);
    for (const event of missed) sendEvent(event, event.seq);

    // If run already closed and we've replayed everything, end now
    if (isClosed(id)) {
      reply.raw.end();
      return;
    }

    const emitter = getOrCreateEmitter(id);

    const onEvent = (event: { seq?: number }) => sendEvent(event, event.seq);
    const onClose = () => { reply.raw.end(); };

    emitter.on("event", onEvent);
    emitter.once("close", onClose);

    // Clean up if client disconnects
    request.raw.on("close", () => {
      emitter.off("event", onEvent);
      emitter.off("close", onClose);
    });

    // Keep alive ping every 15s
    const ping = setInterval(() => {
      if (reply.raw.writable) {
        reply.raw.write(": ping\n\n");
      } else {
        clearInterval(ping);
      }
    }, 15000);

    emitter.once("close", () => clearInterval(ping));
    request.raw.on("close", () => clearInterval(ping));
  });
}
