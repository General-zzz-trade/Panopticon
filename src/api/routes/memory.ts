import type { FastifyInstance } from "fastify";
import {
  upsertMemory, getMemory, listMemory, deleteMemory, clearMemory, getFrequentGoals
} from "../../user-memory/store";

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  // GET /memory — list all memory for tenant
  app.get<{ Querystring: { category?: string } }>("/memory", async (request, reply) => {
    const entries = listMemory(request.tenantId, request.query.category);
    const frequentGoals = getFrequentGoals(request.tenantId);
    return reply.send({ entries, frequentGoals });
  });

  // PUT /memory/:key — upsert a memory entry
  app.put<{
    Params: { key: string };
    Body: { value: string; category?: string };
  }>("/memory/:key", {
    schema: {
      body: {
        type: "object",
        required: ["value"],
        properties: {
          value: { type: "string", minLength: 1, maxLength: 2000 },
          category: { type: "string", enum: ["preference", "frequent_goal", "context", "general"] }
        }
      }
    }
  }, async (request, reply) => {
    const { key } = request.params;
    const { value, category = "general" } = request.body;
    upsertMemory(request.tenantId, key, value, category as "preference" | "frequent_goal" | "context" | "general");
    return reply.send(getMemory(request.tenantId, key));
  });

  // GET /memory/:key
  app.get<{ Params: { key: string } }>("/memory/:key", async (request, reply) => {
    const entry = getMemory(request.tenantId, request.params.key);
    if (!entry) return reply.code(404).send({ error: "Memory entry not found" });
    return reply.send(entry);
  });

  // DELETE /memory/:key
  app.delete<{ Params: { key: string } }>("/memory/:key", async (request, reply) => {
    deleteMemory(request.tenantId, request.params.key);
    return reply.code(204).send();
  });

  // DELETE /memory — clear all memory for tenant
  app.delete("/memory", async (request, reply) => {
    clearMemory(request.tenantId);
    return reply.code(204).send();
  });
}
