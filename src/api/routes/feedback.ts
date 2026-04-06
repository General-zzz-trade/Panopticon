/**
 * Feedback API — store and retrieve user feedback on agent messages.
 */

import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client";

const CREATE_FEEDBACK_TABLE = `
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  message_index INTEGER NOT NULL,
  rating TEXT NOT NULL CHECK(rating IN ('up', 'down')),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_run ON feedback(run_id);
CREATE INDEX IF NOT EXISTS idx_feedback_tenant ON feedback(tenant_id);
`;

export function initFeedbackTable(): void {
  getDb().exec(CREATE_FEEDBACK_TABLE);
}

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /feedback — store user feedback on an agent message
   */
  app.post<{
    Body: {
      runId: string;
      messageIndex: number;
      rating: "up" | "down";
      comment?: string;
    };
  }>(
    "/feedback",
    {
      schema: {
        body: {
          type: "object",
          required: ["runId", "messageIndex", "rating"],
          properties: {
            runId: { type: "string", minLength: 1 },
            messageIndex: { type: "integer", minimum: 0 },
            rating: { type: "string", enum: ["up", "down"] },
            comment: { type: "string", maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
      const { runId, messageIndex, rating, comment } = request.body;
      const tenantId = request.tenantId ?? "default";

      const db = getDb();
      const stmt = db.prepare(
        `INSERT INTO feedback (run_id, tenant_id, message_index, rating, comment)
         VALUES (?, ?, ?, ?, ?)`
      );
      const result = stmt.run(runId, tenantId, messageIndex, rating, comment ?? null);

      return reply.code(201).send({
        id: result.lastInsertRowid,
        runId,
        messageIndex,
        rating,
        comment: comment ?? null,
      });
    }
  );

  /**
   * GET /feedback/stats — aggregate feedback statistics
   */
  app.get("/feedback/stats", async (request, reply) => {
    const tenantId = request.tenantId ?? "default";
    const db = getDb();

    const stats = db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN rating = 'up' THEN 1 ELSE 0 END) as up_count,
           SUM(CASE WHEN rating = 'down' THEN 1 ELSE 0 END) as down_count
         FROM feedback
         WHERE tenant_id = ?`
      )
      .get(tenantId) as { total: number; up_count: number; down_count: number };

    const recent = db
      .prepare(
        `SELECT id, run_id, message_index, rating, comment, created_at
         FROM feedback
         WHERE tenant_id = ?
         ORDER BY created_at DESC
         LIMIT 20`
      )
      .all(tenantId);

    return reply.send({
      total: stats.total,
      up_count: stats.up_count,
      down_count: stats.down_count,
      recent,
    });
  });
}
