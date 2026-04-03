import type { FastifyInstance } from "fastify";
import { isReactConfigured, runReactGoal } from "../../core/react-loop";

export async function reactRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { goal: string; maxSteps?: number } }>("/react", {
    schema: {
      body: {
        type: "object",
        required: ["goal"],
        properties: {
          goal: { type: "string", minLength: 1 },
          maxSteps: { type: "number", minimum: 1, maximum: 50 }
        }
      }
    }
  }, async (request, reply) => {
    if (!isReactConfigured()) {
      return reply.code(503).send({ error: "ReAct mode requires LLM_REACT_PROVIDER and LLM_REACT_API_KEY" });
    }

    const result = await runReactGoal(request.body.goal, {
      maxSteps: request.body.maxSteps
    });

    return reply.send(result);
  });
}
