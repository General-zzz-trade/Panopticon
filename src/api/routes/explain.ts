/**
 * Explain Routes — query reasoning traces for decision explanations.
 *
 * GET /runs/:id/explain          → explain entire run
 * GET /runs/:id/explain/:taskId  → explain decision for specific task
 */

import type { FastifyInstance } from "fastify";
import { explainRun, explainBrief, explainDecision } from "../../cognition/explainability";
import type { ReasoningTrace } from "../../cognition/reasoning-trace";

// In-memory trace storage (populated by runtime after each run)
const traceStore = new Map<string, ReasoningTrace>();

export function storeReasoningTrace(runId: string, trace: ReasoningTrace): void {
  traceStore.set(runId, trace);
  // Keep last 50 traces
  if (traceStore.size > 50) {
    const oldest = traceStore.keys().next().value;
    if (oldest) traceStore.delete(oldest);
  }
}

export async function explainRoutes(app: FastifyInstance): Promise<void> {
  // GET /runs/:id/explain — explain the entire run
  app.get<{ Params: { id: string } }>("/runs/:id/explain", async (request, reply) => {
    const trace = traceStore.get(request.params.id);
    if (!trace) {
      return reply.code(404).send({ error: "No reasoning trace found for this run" });
    }
    return reply.send({
      runId: trace.runId,
      totalDecisions: trace.entries.length,
      explanation: explainRun(trace),
      entries: trace.entries.map(e => ({
        taskId: e.taskId,
        taskType: e.taskType,
        step: e.stepIndex,
        chosen: e.chosen.action,
        confidence: e.confidence,
        brief: explainBrief(trace, e.taskId)
      }))
    });
  });

  // GET /runs/:id/explain/:taskId — explain a specific task decision
  app.get<{ Params: { id: string; taskId: string } }>("/runs/:id/explain/:taskId", async (request, reply) => {
    const trace = traceStore.get(request.params.id);
    if (!trace) {
      return reply.code(404).send({ error: "No reasoning trace found for this run" });
    }
    const explanation = explainDecision(trace, request.params.taskId);
    if (!explanation) {
      return reply.code(404).send({ error: "No trace entry found for this task" });
    }
    return reply.send(explanation);
  });
}
