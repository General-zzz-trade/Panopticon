import type { FastifyInstance } from "fastify";
import { listRuns, getRun } from "../../db/runs-repo";
import { getRunStatus } from "../run-store";
import { submitJob, getQueue } from "../../worker/pool";
import { sanitizeGoal } from "../sanitize";
import { detectAmbiguity } from "../../clarification/detector";
import { storeClarification, answerClarification, deleteClarification } from "../../clarification/store";
import { decomposeGoal, summarizeDecomposition } from "../../decomposer";
import { isDangerousGoal, auditLog, maskSensitive } from "../security";
import { recordFrequentGoal } from "../../user-memory/store";

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

    // Dangerous goal check — warn but don't block (return flag for UI to confirm)
    const danger = isDangerousGoal(goal);
    if (danger.dangerous && !request.body.options?.["confirmDangerous"]) {
      auditLog({ tenantId: request.tenantId, action: "dangerous_goal_blocked", detail: danger.reason });
      return reply.code(400).send({
        error: "dangerous_goal",
        reason: danger.reason,
        hint: 'Add { "options": { "confirmDangerous": true } } to proceed'
      });
    }

    const clarification = detectAmbiguity(goal);
    if (clarification.needed) {
      const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
      storeClarification({ runId, originalGoal: goal, question: clarification.question!, askedAt: new Date().toISOString() });
      return reply.code(200).send({
        runId,
        status: "needs_clarification",
        question: clarification.question,
        hint: `POST /api/v1/runs/${runId}/clarify with { "answer": "..." } to continue`
      });
    }

    const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
    const decomposition = decomposeGoal(goal);
    submitJob(runId, goal, options, request.tenantId);
    recordFrequentGoal(request.tenantId, goal);
    auditLog({ tenantId: request.tenantId, action: "run_submitted", resource: runId, detail: maskSensitive(goal) });
    return reply.code(202).send({
      runId,
      status: "pending",
      tenantId: request.tenantId,
      decomposition: decomposition.decomposed
        ? { steps: decomposition.subGoals.length, preview: summarizeDecomposition(decomposition) }
        : undefined
    });
  });

  // GET /runs — list recent runs
  app.get<{ Querystring: { limit?: string; offset?: string } }>("/runs", async (request, reply) => {
    const limit = Math.min(Number(request.query.limit ?? 20), 100);
    const offset = Number(request.query.offset ?? 0);
    const runs = listRuns(limit, offset, request.tenantId);
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
    const run = getRun(request.params.id, request.tenantId);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    return reply.send(run);
  });

  // GET /runs/:id/status — live status (pending/running) or from DB
  app.get<{ Params: { id: string } }>("/runs/:id/status", async (request, reply) => {
    const live = getRunStatus(request.params.id);
    if (live) return reply.send({ runId: request.params.id, status: live });
    const run = getRun(request.params.id, request.tenantId);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    return reply.send({
      runId: run.runId,
      status: run.result ? (run.result.success ? "success" : "failed") : "unknown"
    });
  });

  // GET /runs/:id/artifacts — list artifacts
  app.get<{ Params: { id: string } }>("/runs/:id/artifacts", async (request, reply) => {
    const run = getRun(request.params.id, request.tenantId);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    return reply.send({ artifacts: run.artifacts });
  });

  // POST /runs/:id/clarify — answer a clarification question to resume planning
  app.post<{ Params: { id: string }; Body: { answer: string } }>(
    "/runs/:id/clarify",
    {
      schema: {
        body: {
          type: "object",
          required: ["answer"],
          properties: { answer: { type: "string", minLength: 1, maxLength: 2000 } }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const { answer } = request.body;
      const record = answerClarification(id, answer);
      if (!record) return reply.code(404).send({ error: "Clarification request not found or already answered." });
      const enrichedGoal = `${record.originalGoal} (clarification: ${answer})`;
      deleteClarification(id);
      submitJob(id, enrichedGoal, {}, request.tenantId);
      return reply.code(202).send({ runId: id, status: "accepted", enrichedGoal });
    }
  );

  // GET /queue/stats — worker pool status
  app.get("/queue/stats", async (_request, reply) => {
    return reply.send(getQueue().stats);
  });
}
