import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getDb } from "../../db/client";
import { CREATE_API_KEYS_TABLE } from "../../db/schema";

// Ensure api_keys table exists
export function initApiKeysTable(): void {
  const db = getDb();
  db.exec(CREATE_API_KEYS_TABLE);
}

export function createApiKey(name: string): string {
  const db = getDb();
  const key = `ak_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  db.prepare("INSERT INTO api_keys (key, name) VALUES (?, ?)").run(key, name);
  return key;
}

export function validateApiKey(key: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT id FROM api_keys WHERE key = ? AND enabled = 1").get(key);
  if (!row) return false;
  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE key = ?").run(key);
  return true;
}

export async function authPlugin(app: FastifyInstance): Promise<void> {
  const BYPASS_AUTH = process.env.AGENT_API_AUTH === "false";

  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (BYPASS_AUTH) return;
    // Skip auth for health check
    if (request.url === "/health") return;

    const apiKey = request.headers["x-api-key"] as string | undefined;
    if (!apiKey || !validateApiKey(apiKey)) {
      return reply.code(401).send({ error: "Unauthorized: provide a valid X-Api-Key header" });
    }
  });
}
