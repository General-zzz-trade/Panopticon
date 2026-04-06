import type { FastifyInstance } from "fastify";
import type { AgentAction } from "../types";

/**
 * MCP (Model Context Protocol) adapter — maps MCP tool calls to agent task types
 * and exposes them via REST endpoints.
 */

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

interface MCPToolMapping {
  definition: MCPToolDefinition;
  agentAction: AgentAction;
  /** Maps MCP param names to agent task payload keys */
  paramMap: Record<string, string>;
}

const TOOL_MAPPINGS: MCPToolMapping[] = [
  {
    definition: {
      name: "browse_url",
      description: "Open a URL in the browser",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to navigate to" }
        },
        required: ["url"]
      }
    },
    agentAction: "open_page",
    paramMap: { url: "url" }
  },
  {
    definition: {
      name: "click_element",
      description: "Click an element identified by CSS selector",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector for the element" }
        },
        required: ["selector"]
      }
    },
    agentAction: "click",
    paramMap: { selector: "selector" }
  },
  {
    definition: {
      name: "type_text",
      description: "Type text into an input element",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector for the input element" },
          text: { type: "string", description: "Text to type" }
        },
        required: ["selector", "text"]
      }
    },
    agentAction: "type",
    paramMap: { selector: "selector", text: "text" }
  },
  {
    definition: {
      name: "take_screenshot",
      description: "Take a screenshot of the current page",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to save the screenshot (optional)" }
        }
      }
    },
    agentAction: "screenshot",
    paramMap: { path: "path" }
  },
  {
    definition: {
      name: "http_request",
      description: "Make an HTTP request",
      inputSchema: {
        type: "object",
        properties: {
          method: { type: "string", description: "HTTP method (GET, POST, PUT, DELETE, etc.)" },
          url: { type: "string", description: "Request URL" },
          body: { type: "string", description: "Request body (optional)" },
          headers: { type: "string", description: "JSON-encoded headers (optional)" }
        },
        required: ["method", "url"]
      }
    },
    agentAction: "http_request",
    paramMap: { method: "method", url: "url", body: "body", headers: "headers" }
  },
  {
    definition: {
      name: "run_shell",
      description: "Run a shell command or code snippet",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "Code or command to execute" },
          language: { type: "string", description: "Language (bash, javascript, python)" }
        },
        required: ["code"]
      }
    },
    agentAction: "run_code",
    paramMap: { code: "code", language: "language" }
  },
  {
    definition: {
      name: "read_file",
      description: "Read the contents of a file",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to read" }
        },
        required: ["path"]
      }
    },
    agentAction: "read_file",
    paramMap: { path: "path" }
  }
];

const toolsByName = new Map(TOOL_MAPPINGS.map(m => [m.definition.name, m]));

/**
 * Returns MCP-compatible tool definition array.
 */
export function getMCPToolDefinitions(): MCPToolDefinition[] {
  return TOOL_MAPPINGS.map(m => m.definition);
}

/**
 * Execute an MCP tool by name, mapping params to an agent task payload.
 * Returns a result object with the mapped task info (actual execution
 * is delegated to the caller or the runtime).
 */
export async function executeMCPTool(
  toolName: string,
  params: Record<string, unknown>,
  _runContext?: unknown
): Promise<{ success: boolean; agentAction?: AgentAction; payload?: Record<string, unknown>; error?: string }> {
  const mapping = toolsByName.get(toolName);
  if (!mapping) {
    return { success: false, error: `Unknown MCP tool: ${toolName}` };
  }

  // Validate required params
  const required = mapping.definition.inputSchema.required ?? [];
  for (const req of required) {
    if (params[req] === undefined || params[req] === null) {
      return { success: false, error: `Missing required parameter: ${req}` };
    }
  }

  // Map MCP params to agent payload
  const payload: Record<string, unknown> = {};
  for (const [mcpKey, agentKey] of Object.entries(mapping.paramMap)) {
    if (params[mcpKey] !== undefined) {
      payload[agentKey] = params[mcpKey];
    }
  }

  // If a real RunContext is provided, attempt to dispatch via the executor
  if (_runContext) {
    try {
      const { executeTask } = await import("../core/executor");
      const task: import("../types").AgentTask = {
        id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: mapping.agentAction,
        status: "pending",
        retries: 0,
        attempts: 0,
        replanDepth: 0,
        payload: payload as Record<string, string | number | boolean | undefined>
      };

      const result = await executeTask(_runContext as import("../types").RunContext, task);
      return { success: true, agentAction: mapping.agentAction, payload: { task, result } };
    } catch {
      // Executor failed — fall through to return the mapping
    }
  }

  // No runContext or executor unavailable — return the mapped action for the caller to dispatch
  return {
    success: true,
    agentAction: mapping.agentAction,
    payload
  };
}

/**
 * Register MCP routes on a Fastify instance.
 */
export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  // GET /mcp/tools — list available tools
  app.get("/mcp/tools", async (_request, reply) => {
    return reply.send({ tools: getMCPToolDefinitions() });
  });

  // POST /mcp/execute — execute a tool
  app.post<{
    Body: { tool: string; params: Record<string, unknown> };
  }>("/mcp/execute", {
    schema: {
      body: {
        type: "object",
        required: ["tool", "params"],
        properties: {
          tool: { type: "string" },
          params: { type: "object" }
        }
      }
    }
  }, async (request, reply) => {
    const { tool, params } = request.body;
    const result = await executeMCPTool(tool, params);
    if (!result.success && result.error?.startsWith("Unknown MCP tool")) {
      return reply.code(404).send({ error: result.error });
    }
    if (!result.success) {
      return reply.code(400).send({ error: result.error });
    }
    return reply.send(result);
  });
}
