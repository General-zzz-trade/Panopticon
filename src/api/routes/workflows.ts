/**
 * Workflow API routes — CRUD and execution of workflow definitions.
 */

import type { FastifyInstance } from "fastify";
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  deleteWorkflow,
  runWorkflow,
} from "../../orchestration/workflow-engine";

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  // GET /workflows — list all workflows
  app.get("/workflows", async (_request, reply) => {
    const all = listWorkflows();
    return reply.send({ workflows: all });
  });

  // POST /workflows — create a new workflow
  app.post<{
    Body: {
      name: string;
      description: string;
      steps: Array<{
        id: string;
        type: string;
        task?: { type: string; payload: Record<string, unknown> };
        condition?: { expression: string; thenSteps: string[]; elseSteps: string[] };
        loop?: { times: number; steps: string[] };
        parallel?: { steps: string[][] };
        next?: string;
      }>;
      variables?: Record<string, unknown>;
    };
  }>("/workflows", {
    schema: {
      body: {
        type: "object",
        required: ["name", "description", "steps"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 200 },
          description: { type: "string", maxLength: 2000 },
          steps: { type: "array", minItems: 1 },
          variables: { type: "object" },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const workflow = createWorkflow({
        name: request.body.name,
        description: request.body.description,
        steps: request.body.steps as any,
        variables: request.body.variables ?? {},
      });
      return reply.code(201).send({ workflow });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });

  // GET /workflows/:id — get workflow detail
  app.get<{ Params: { id: string } }>("/workflows/:id", async (request, reply) => {
    const workflow = getWorkflow(request.params.id);
    if (!workflow) {
      return reply.code(404).send({ error: "Workflow not found" });
    }
    return reply.send({ workflow });
  });

  // POST /workflows/:id/run — execute a workflow
  app.post<{
    Params: { id: string };
    Body: { variables?: Record<string, unknown> };
  }>("/workflows/:id/run", async (request, reply) => {
    const workflow = getWorkflow(request.params.id);
    if (!workflow) {
      return reply.code(404).send({ error: "Workflow not found" });
    }

    try {
      const run = await runWorkflow(request.params.id, request.body?.variables);
      return reply.send({ run });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: message });
    }
  });

  // DELETE /workflows/:id — delete a workflow
  app.delete<{ Params: { id: string } }>("/workflows/:id", async (request, reply) => {
    const deleted = deleteWorkflow(request.params.id);
    if (!deleted) {
      return reply.code(404).send({ error: "Workflow not found" });
    }
    return reply.code(204).send();
  });
}
