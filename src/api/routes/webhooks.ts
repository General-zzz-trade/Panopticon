import type { FastifyInstance } from "fastify";
import {
  registerWebhook,
  listWebhooks,
  getWebhook,
  deleteWebhook,
  fireWebhook,
  isValidEvent,
} from "../../webhooks/manager";

/* ------------------------------------------------------------------ */
/*  Webhook Routes                                                     */
/* ------------------------------------------------------------------ */

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // GET /webhooks — list all webhooks
  app.get("/webhooks", async (_request, reply) => {
    const hooks = listWebhooks();
    return reply.send({
      webhooks: hooks.map((w) => ({
        id: w.id,
        url: w.url,
        events: w.events,
        enabled: w.enabled,
        createdAt: w.createdAt,
      })),
    });
  });

  // POST /webhooks — register a new webhook
  app.post<{
    Body: { url: string; events: string[]; secret?: string; enabled?: boolean };
  }>(
    "/webhooks",
    {
      schema: {
        body: {
          type: "object",
          required: ["url", "events"],
          properties: {
            url: { type: "string", minLength: 1, maxLength: 2000 },
            events: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
            },
            secret: { type: "string", maxLength: 256 },
            enabled: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const { url, events, secret, enabled } = request.body;

      // Validate events
      const invalid = events.filter((e) => !isValidEvent(e));
      if (invalid.length > 0) {
        return reply.code(400).send({
          error: "Invalid events",
          invalidEvents: invalid,
          validEvents: ["run.complete", "run.failed", "task.done", "schedule.triggered"],
        });
      }

      const webhook = registerWebhook({
        url,
        events,
        secret,
        enabled: enabled !== false,
      });

      return reply.code(201).send(webhook);
    }
  );

  // DELETE /webhooks/:id — remove a webhook
  app.delete<{ Params: { id: string } }>("/webhooks/:id", async (request, reply) => {
    const existing = getWebhook(request.params.id);
    if (!existing) return reply.code(404).send({ error: "Webhook not found" });
    deleteWebhook(request.params.id);
    return reply.code(204).send();
  });

  // POST /webhooks/:id/test — send a test payload
  app.post<{ Params: { id: string } }>("/webhooks/:id/test", async (request, reply) => {
    const webhook = getWebhook(request.params.id);
    if (!webhook) return reply.code(404).send({ error: "Webhook not found" });

    const testPayload = {
      test: true,
      message: "This is a test webhook delivery",
      webhookId: webhook.id,
      timestamp: new Date().toISOString(),
    };

    // Fire to just this webhook by using its first event type
    const event = webhook.events[0] ?? "run.complete";
    const results = await fireWebhook(event, testPayload);

    // The fireWebhook sends to all matching — filter to just this one
    const result = results.find((r) => r.webhookId === webhook.id);

    if (result) {
      return reply.send({
        webhookId: webhook.id,
        delivered: result.success,
        statusCode: result.statusCode,
        error: result.error ?? null,
      });
    }

    // Webhook might not have matched (disabled, etc.) — deliver directly
    return reply.send({
      webhookId: webhook.id,
      delivered: false,
      statusCode: null,
      error: "Webhook did not match (may be disabled or event mismatch)",
    });
  });
}
