/**
 * Custom Tool Registry
 *
 * In-memory registry for user-defined tools that can be invoked via
 * webhook POST or sandboxed code evaluation.
 */

import { Script, createContext } from "node:vm";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: "webhook" | "code";
  /** URL to POST params to (webhook handler) */
  endpoint?: string;
  /** JavaScript code string to evaluate (code handler) */
  code?: string;
}

export interface ToolExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
}

const registry = new Map<string, ToolDefinition>();

export function registerTool(def: ToolDefinition): void {
  if (registry.has(def.name)) {
    throw new Error(`Tool already registered: ${def.name}`);
  }
  if (def.handler === "webhook" && !def.endpoint) {
    throw new Error("Webhook tools require an endpoint URL");
  }
  if (def.handler === "code" && !def.code) {
    throw new Error("Code tools require a code string");
  }
  registry.set(def.name, def);
}

export function unregisterTool(name: string): boolean {
  return registry.delete(name);
}

export function listTools(): ToolDefinition[] {
  return Array.from(registry.values());
}

export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name);
}

/**
 * Execute a registered custom tool with given params.
 */
export async function executeTool(
  name: string,
  params: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const tool = registry.get(name);
  if (!tool) {
    return { success: false, error: `Tool not found: ${name}`, durationMs: 0 };
  }

  const start = Date.now();

  if (tool.handler === "webhook") {
    return executeWebhookTool(tool, params, start);
  }

  if (tool.handler === "code") {
    return executeCodeTool(tool, params, start);
  }

  return { success: false, error: `Unknown handler type: ${tool.handler}`, durationMs: Date.now() - start };
}

async function executeWebhookTool(
  tool: ToolDefinition,
  params: Record<string, unknown>,
  start: number
): Promise<ToolExecutionResult> {
  try {
    const response = await fetch(tool.endpoint!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(30_000)
    });

    const body = await response.text();
    let output: unknown;
    try {
      output = JSON.parse(body);
    } catch {
      output = body;
    }

    return {
      success: response.ok,
      output,
      error: response.ok ? undefined : `HTTP ${response.status}: ${body.slice(0, 500)}`,
      durationMs: Date.now() - start
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start
    };
  }
}

async function executeCodeTool(
  tool: ToolDefinition,
  params: Record<string, unknown>,
  start: number
): Promise<ToolExecutionResult> {
  try {
    // Run user code in a Node.js VM context with limited globals.
    // NOTE: node:vm is NOT a security sandbox — for production use,
    // consider isolated-vm or a container-based approach.
    const sandbox = {
      params,
      result: undefined as unknown,
      console: { log: (...args: unknown[]) => args },
      JSON,
      Math,
      Date,
      parseInt,
      parseFloat,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      Promise,
      Error
    };

    const context = createContext(sandbox);
    const wrappedCode = `
      (async () => {
        ${tool.code}
      })().then(r => { result = r; });
    `;

    const script = new Script(wrappedCode);
    const promise = script.runInContext(context, { timeout: 10_000 });

    // The script returns a promise stored in sandbox.result
    await promise;

    // Also await the result assignment if it was async
    if (sandbox.result instanceof Promise) {
      sandbox.result = await Promise.race([
        sandbox.result,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Code execution timed out (10s)")), 10_000)
        )
      ]);
    }

    return {
      success: true,
      output: sandbox.result,
      durationMs: Date.now() - start
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start
    };
  }
}
