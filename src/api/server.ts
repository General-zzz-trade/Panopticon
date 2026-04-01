import Fastify from "fastify";
import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runsRoutes } from "./routes/runs";
import { streamRoutes } from "./routes/stream";
import { schedulesRoutes } from "./routes/schedules";
import { memoryRoutes } from "./routes/memory";
import { authPlugin, initApiKeysTable, createApiKey } from "./plugins/auth";
import { initSchedulesTable } from "../scheduler/store";
import { startScheduler } from "../scheduler/engine";
import { initUserMemoryTable } from "../user-memory/store";
import { renderPrometheus } from "../observability/metrics-store";
import { listPlugins } from "../plugins/registry";
import { getKnowledgeStats } from "../knowledge/store";
import { initAuditTable, rateLimitHook, auditLog } from "./security";

export async function buildServer() {
  initApiKeysTable();
  initSchedulesTable();
  initUserMemoryTable();
  initAuditTable();
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  // Serve Web UI from public/ directory
  const publicDir = join(fileURLToPath(import.meta.url), "../../../public");
  await app.register(staticFiles, { root: publicDir, prefix: "/" });

  // Rate limiting on all API routes
  app.addHook("preHandler", rateLimitHook);

  await app.register(authPlugin);
  await app.register(runsRoutes, { prefix: "/api/v1" });
  await app.register(streamRoutes, { prefix: "/api/v1" });
  await app.register(schedulesRoutes, { prefix: "/api/v1" });
  await app.register(memoryRoutes, { prefix: "/api/v1" });

  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString()
  }));

  // List registered plugins
  app.get("/api/v1/plugins", async (_req, reply) => {
    return reply.send({ plugins: listPlugins() });
  });

  // Knowledge base stats
  app.get("/api/v1/knowledge/stats", async (_req, reply) => {
    return reply.send(getKnowledgeStats());
  });

  // Prometheus metrics endpoint — bypass auth (scrapers don't use API keys)
  app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", "text/plain; version=0.0.4");
    return reply.send(renderPrometheus());
  });

  // Key management: create a new API key (requires existing key or auth bypass)
  app.post<{ Body: { name: string } }>("/api/v1/keys", {
    schema: {
      body: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string", minLength: 1, maxLength: 100 } }
      }
    }
  }, async (request, reply) => {
    const key = createApiKey(request.body.name);
    return reply.code(201).send({ key, name: request.body.name });
  });

  return app;
}

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";

  const app = await buildServer();
  await app.listen({ port, host });
  startScheduler();
  console.log(`Agent API listening on http://${host}:${port}`);
  console.log(`  GET  /                   - Web UI 控制台`);
  console.log(`  POST /api/v1/runs        - submit goal (async)`);
  console.log(`  GET  /api/v1/runs        - list runs`);
  console.log(`  GET  /api/v1/runs/:id    - run detail`);
  console.log(`  GET  /api/v1/runs/:id/status    - live status`);
  console.log(`  GET  /api/v1/runs/:id/artifacts - artifacts`);
  console.log(`  GET  /api/v1/runs/:id/stream     - SSE real-time event stream`);
  console.log(`  GET  /health             - health check`);
  console.log(`  POST /api/v1/keys        - create API key`);
  console.log(`  GET  /api/v1/knowledge/stats     - knowledge base stats`);
  console.log(`  GET/POST /api/v1/schedules       - cron schedule management`);
  console.log(`  Set AGENT_API_AUTH=false to disable auth (dev mode)`);
}

// Only start server when executed directly (not imported by tests)
import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
