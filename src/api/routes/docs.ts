import type { FastifyInstance } from "fastify";

/**
 * OpenAPI 3.0 specification — hand-authored (no @fastify/swagger dependency).
 */
const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Agent Orchestrator API",
    version: "1.0.0",
    description:
      "Cognitive agent runtime for UI automation — plan, execute, verify, and recover."
  },
  servers: [{ url: "/api/v1", description: "Default API prefix" }],
  paths: {
    "/runs": {
      post: {
        summary: "Submit a new goal",
        operationId: "createRun",
        tags: ["Runs"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["goal"],
                properties: {
                  goal: { type: "string", minLength: 1, maxLength: 2000 },
                  options: { type: "object", additionalProperties: true }
                }
              }
            }
          }
        },
        responses: {
          "202": {
            description: "Run accepted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    runId: { type: "string" },
                    status: { type: "string" },
                    tenantId: { type: "string" },
                    decomposition: { type: "object" }
                  }
                }
              }
            }
          },
          "400": { description: "Invalid or dangerous goal" }
        }
      },
      get: {
        summary: "List recent runs",
        operationId: "listRuns",
        tags: ["Runs"],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } }
        ],
        responses: {
          "200": {
            description: "Paginated run list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    runs: { type: "array", items: { $ref: "#/components/schemas/RunSummary" } },
                    limit: { type: "integer" },
                    offset: { type: "integer" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/runs/{id}": {
      get: {
        summary: "Get full run detail",
        operationId: "getRun",
        tags: ["Runs"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Run detail" },
          "404": { description: "Run not found" }
        }
      }
    },
    "/runs/{id}/stream": {
      get: {
        summary: "SSE event stream for a run",
        operationId: "streamRun",
        tags: ["Runs"],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "lastEventId", in: "query", schema: { type: "string" } }
        ],
        responses: {
          "200": { description: "text/event-stream of run events" }
        }
      }
    },
    "/runs/{id}/cancel": {
      post: {
        summary: "Request cancellation of a run",
        operationId: "cancelRun",
        tags: ["Runs"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "202": { description: "Cancellation requested" }
        }
      }
    },
    "/runs/{id}/clarify": {
      post: {
        summary: "Answer a clarification question to resume planning",
        operationId: "clarifyRun",
        tags: ["Runs"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["answer"],
                properties: { answer: { type: "string", minLength: 1, maxLength: 2000 } }
              }
            }
          }
        },
        responses: {
          "202": { description: "Clarification accepted, run resumed" },
          "404": { description: "Clarification not found" }
        }
      }
    },
    "/runs/{id}/status": {
      get: {
        summary: "Get live or stored run status",
        operationId: "getRunStatus",
        tags: ["Runs"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Run status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    runId: { type: "string" },
                    status: { type: "string" }
                  }
                }
              }
            }
          },
          "404": { description: "Run not found" }
        }
      }
    },
    "/runs/{id}/artifacts": {
      get: {
        summary: "List artifacts for a run",
        operationId: "getRunArtifacts",
        tags: ["Runs"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Artifact list" },
          "404": { description: "Run not found" }
        }
      }
    },
    "/runs/{id}/cognition": {
      get: {
        summary: "Get structured cognition trace for a run",
        operationId: "getRunCognition",
        tags: ["Runs"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Cognition trace" },
          "404": { description: "Run not found" }
        }
      }
    },
    "/auth/login": {
      post: {
        summary: "Login with API key",
        operationId: "authLogin",
        tags: ["Auth"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["apiKey"],
                properties: { apiKey: { type: "string" } }
              }
            }
          }
        },
        responses: {
          "200": { description: "Authentication successful" },
          "401": { description: "Invalid API key" }
        }
      }
    },
    "/auth/register": {
      post: {
        summary: "Register a new API key",
        operationId: "authRegister",
        tags: ["Auth"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  tenantId: { type: "string" },
                  label: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          "201": { description: "API key created" }
        }
      }
    },
    "/billing/usage": {
      get: {
        summary: "Get token usage and billing summary",
        operationId: "getBillingUsage",
        tags: ["Billing"],
        parameters: [
          { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "until", in: "query", schema: { type: "string", format: "date-time" } }
        ],
        responses: {
          "200": { description: "Usage summary" }
        }
      }
    },
    "/queue/stats": {
      get: {
        summary: "Worker pool queue statistics",
        operationId: "getQueueStats",
        tags: ["System"],
        responses: { "200": { description: "Queue stats" } }
      }
    },
    "/mcp/tools": {
      get: {
        summary: "List available MCP tools",
        operationId: "listMCPTools",
        tags: ["MCP"],
        responses: { "200": { description: "MCP tool definitions" } }
      }
    },
    "/mcp/execute": {
      post: {
        summary: "Execute an MCP tool",
        operationId: "executeMCPTool",
        tags: ["MCP"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["tool", "params"],
                properties: {
                  tool: { type: "string" },
                  params: { type: "object" }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Tool execution result" },
          "404": { description: "Tool not found" }
        }
      }
    },
    "/tools/custom": {
      get: {
        summary: "List registered custom tools",
        operationId: "listCustomTools",
        tags: ["Custom Tools"],
        responses: { "200": { description: "Custom tool list" } }
      },
      post: {
        summary: "Register a new custom tool",
        operationId: "registerCustomTool",
        tags: ["Custom Tools"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ToolDefinition" }
            }
          }
        },
        responses: {
          "201": { description: "Tool registered" },
          "409": { description: "Tool already exists" }
        }
      }
    },
    "/tools/custom/{name}": {
      delete: {
        summary: "Unregister a custom tool",
        operationId: "unregisterCustomTool",
        tags: ["Custom Tools"],
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Tool removed" },
          "404": { description: "Tool not found" }
        }
      }
    },
    "/tools/custom/{name}/execute": {
      post: {
        summary: "Execute a custom tool",
        operationId: "executeCustomTool",
        tags: ["Custom Tools"],
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { params: { type: "object" } } }
            }
          }
        },
        responses: {
          "200": { description: "Execution result" },
          "404": { description: "Tool not found" }
        }
      }
    }
  },
  components: {
    schemas: {
      RunSummary: {
        type: "object",
        properties: {
          runId: { type: "string" },
          goal: { type: "string" },
          status: { type: "string", enum: ["success", "failed", "running", "pending"] },
          plannerUsed: { type: "string" },
          startedAt: { type: "string" },
          endedAt: { type: "string" },
          replanCount: { type: "integer" },
          taskCount: { type: "integer" }
        }
      },
      ToolDefinition: {
        type: "object",
        required: ["name", "description", "inputSchema", "handler"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          inputSchema: { type: "object" },
          handler: { type: "string", enum: ["webhook", "code"] },
          endpoint: { type: "string" },
          code: { type: "string" }
        }
      }
    },
    securitySchemes: {
      ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" }
    }
  },
  security: [{ ApiKeyAuth: [] }]
};

const SWAGGER_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Agent Orchestrator — API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>body{margin:0}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/docs/openapi.json', dom_id: '#swagger-ui', deepLinking: true });
  </script>
</body>
</html>`;

export async function docsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/docs/openapi.json", async (_request, reply) => {
    return reply.type("application/json").send(openapiSpec);
  });

  app.get("/docs", async (_request, reply) => {
    return reply.type("text/html").send(SWAGGER_UI_HTML);
  });
}
