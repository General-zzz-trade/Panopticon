import type { FastifyInstance } from "fastify";
import {
  planCoordination,
  getReadyWorkers,
  generateReport
} from "../../orchestration/coordinator";

export async function coordinateRoutes(app: FastifyInstance): Promise<void> {
  // POST /coordinate — plan a multi-agent coordination for a goal
  app.post<{
    Body: { goal: string }
  }>("/coordinate", {
    schema: {
      body: {
        type: "object",
        required: ["goal"],
        properties: {
          goal: { type: "string", minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const plan = planCoordination(request.body.goal);
    const ready = getReadyWorkers(plan);

    return reply.send({
      originalGoal: plan.originalGoal,
      strategy: plan.strategy,
      workers: plan.workers.map(w => ({
        id: w.id,
        goal: w.goal,
        status: w.status
      })),
      readyWorkers: ready.map(w => w.id),
      dependencies: Object.fromEntries(plan.dependencies)
    });
  });
}
