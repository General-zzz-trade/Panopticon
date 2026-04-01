import type { FastifyInstance } from "fastify";
import { listRuns, getRun } from "../../db/runs-repo";
import { getRunStatus } from "../run-store";
import { submitJob, getQueue } from "../../worker/pool";
import { sanitizeGoal } from "../sanitize";

export async function runsRoutes(app: FastifyInstance): Promise<void> {
  // POST /runs — submit a goal (non-blocking, returns 202 immediately)
  app.post<{ Body: { goal: string; options?: Record<string, unknown> } }>("/runs", {
    schema: {
      body: {
        type: "object",
        required: ["goal"],
        properties: {
          goal: { type: "string", minLength: 1, maxLength: 2000 },
          options: { type: "object" }
        }
      }
    }
  }, async (request, reply) => {
    const { goal: rawGoal, options = {} } = request.body;
    const goal = sanitizeGoal(rawGoal);
    if (!goal) return reply.code(400).send({ error: "goal is empty after sanitization" });
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
    submitJob(runId, goal, options);
    return reply.code(202).send({ runId, status: "pending" });
  });

  // GET /runs — list recent runs
  app.get<{ Querystring: { limit?: string; offset?: string } }>("/runs", async (request, reply) => {
    const limit = Math.min(Number(request.query.limit ?? 20), 100);
    const offset = Number(request.query.offset ?? 0);
    const runs = listRuns(limit, offset);
    return reply.send({
      runs: runs.map(r => ({
        runId: r.runId,
        goal: r.goal,
        status: r.result ? (r.result.success ? "success" : "failed") : "running",
        plannerUsed: r.plannerUsed,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        replanCount: r.replanCount,
        taskCount: r.tasks.length
      })),
      limit,
      offset
    });
  });

  // GET /runs/:id — full run detail
  app.get<{ Params: { id: string } }>("/runs/:id", async (request, reply) => {
    const run = getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    return reply.send(run);
  });

  // GET /runs/:id/status — live status (pending/running) or from DB
  app.get<{ Params: { id: string } }>("/runs/:id/status", async (request, reply) => {
    const live = getRunStatus(request.params.id);
    if (live) return reply.send({ runId: request.params.id, status: live });
    const run = getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    return reply.send({
      runId: run.runId,
      status: run.result ? (run.result.success ? "success" : "failed") : "unknown"
    });
  });

  // GET /runs/:id/artifacts — list artifacts
  app.get<{ Params: { id: string } }>("/runs/:id/artifacts", async (request, reply) => {
    const run = getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    return reply.send({ artifacts: run.artifacts });
  });

  // GET /queue/stats — worker pool status
  app.get("/queue/stats", async (_request, reply) => {
    return reply.send(getQueue().stats);
  });
}
