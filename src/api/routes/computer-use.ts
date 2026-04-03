import type { FastifyInstance } from "fastify";
import { isComputerUseConfigured, runComputerUseGoal } from "../../computer-use/agent";

export async function computerUseRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { goal: string; startUrl?: string; maxSteps?: number }
  }>("/computer-use", {
    schema: {
      body: {
        type: "object",
        required: ["goal"],
        properties: {
          goal: { type: "string", minLength: 1 },
          startUrl: { type: "string" },
          maxSteps: { type: "number", minimum: 1, maximum: 50 }
        }
      }
    }
  }, async (request, reply) => {
    if (!isComputerUseConfigured()) {
      return reply.code(503).send({ error: "Computer Use requires ANTHROPIC_API_KEY" });
    }

    const result = await runComputerUseGoal(request.body.goal, {
      startUrl: request.body.startUrl,
      maxSteps: request.body.maxSteps
    });

    return reply.send(result);
  });
}
