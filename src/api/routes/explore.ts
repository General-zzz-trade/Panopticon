import type { FastifyInstance } from "fastify";
import { planExploration, createExplorationReport, DEFAULT_EXPLORATION_CONFIG } from "../../exploration/explorer";
import type { ExplorationConfig } from "../../exploration/explorer";
import { createCausalGraph } from "../../world-model/causal-graph";

export async function exploreRoutes(app: FastifyInstance): Promise<void> {
  // POST /explore — plan an exploration of a URL
  app.post<{
    Body: { url: string; maxSteps?: number; maxDepth?: number }
  }>("/explore", {
    schema: {
      body: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", minLength: 1 },
          maxSteps: { type: "number", minimum: 1, maximum: 100 },
          maxDepth: { type: "number", minimum: 1, maximum: 10 }
        }
      }
    }
  }, async (request, reply) => {
    const { url, maxSteps, maxDepth } = request.body;
    const config: ExplorationConfig = {
      ...DEFAULT_EXPLORATION_CONFIG,
      ...(maxSteps !== undefined && { maxSteps }),
      ...(maxDepth !== undefined && { maxDepth })
    };

    // Plan exploration (without live browser — returns planned actions)
    const plan = planExploration(url, [], new Set(), config);

    return reply.send({
      url,
      plannedActions: plan.actions.length,
      actions: plan.actions,
      config: {
        maxSteps: config.maxSteps,
        maxDepth: config.maxDepth,
        timeout: config.timeout
      }
    });
  });
}
