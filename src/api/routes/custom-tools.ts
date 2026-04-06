import type { FastifyInstance } from "fastify";
import {
  registerTool,
  unregisterTool,
  listTools,
  getTool,
  executeTool,
  type ToolDefinition
} from "../../mcp/tool-registry";

export async function customToolsRoutes(app: FastifyInstance): Promise<void> {
  // GET /tools/custom — list registered custom tools
  app.get("/tools/custom", async (_request, reply) => {
    const tools = listTools();
    return reply.send({
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        handler: t.handler,
        endpoint: t.endpoint
        // Intentionally omit `code` from listing for security
      }))
    });
  });

  // POST /tools/custom — register a new tool
  app.post<{
    Body: ToolDefinition;
  }>("/tools/custom", {
    schema: {
      body: {
        type: "object",
        required: ["name", "description", "inputSchema", "handler"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          description: { type: "string", maxLength: 1000 },
          inputSchema: { type: "object" },
          handler: { type: "string", enum: ["webhook", "code"] },
          endpoint: { type: "string" },
          code: { type: "string" }
        }
      }
    }
  }, async (request, reply) => {
    try {
      registerTool(request.body);
      return reply.code(201).send({
        message: `Tool '${request.body.name}' registered`,
        tool: {
          name: request.body.name,
          description: request.body.description,
          handler: request.body.handler
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already registered")) {
        return reply.code(409).send({ error: msg });
      }
      return reply.code(400).send({ error: msg });
    }
  });

  // DELETE /tools/custom/:name — unregister a tool
  app.delete<{ Params: { name: string } }>("/tools/custom/:name", async (request, reply) => {
    const { name } = request.params;
    const removed = unregisterTool(name);
    if (!removed) {
      return reply.code(404).send({ error: `Tool not found: ${name}` });
    }
    return reply.send({ message: `Tool '${name}' unregistered` });
  });

  // POST /tools/custom/:name/execute — execute a custom tool
  app.post<{
    Params: { name: string };
    Body: { params?: Record<string, unknown> };
  }>("/tools/custom/:name/execute", {
    schema: {
      body: {
        type: "object",
        properties: {
          params: { type: "object" }
        }
      }
    }
  }, async (request, reply) => {
    const { name } = request.params;
    const tool = getTool(name);
    if (!tool) {
      return reply.code(404).send({ error: `Tool not found: ${name}` });
    }

    const result = await executeTool(name, request.body.params ?? {});
    const statusCode = result.success ? 200 : 500;
    return reply.code(statusCode).send(result);
  });
}
