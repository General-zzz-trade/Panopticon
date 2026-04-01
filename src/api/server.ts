import Fastify from "fastify";
import cors from "@fastify/cors";
import { runsRoutes } from "./routes/runs";
import { authPlugin, initApiKeysTable, createApiKey } from "./plugins/auth";

export async function buildServer() {
  initApiKeysTable();
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(authPlugin);
  await app.register(runsRoutes, { prefix: "/api/v1" });

  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString()
  }));

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
  console.log(`Agent API listening on http://${host}:${port}`);
  console.log(`  POST /api/v1/runs        - submit goal (async)`);
  console.log(`  GET  /api/v1/runs        - list runs`);
  console.log(`  GET  /api/v1/runs/:id    - run detail`);
  console.log(`  GET  /api/v1/runs/:id/status    - live status`);
  console.log(`  GET  /api/v1/runs/:id/artifacts - artifacts`);
  console.log(`  GET  /health             - health check`);
  console.log(`  POST /api/v1/keys        - create API key`);
  console.log(`  Set AGENT_API_AUTH=false to disable auth (dev mode)`);
}

// Only start server when executed directly (not imported by tests)
import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
