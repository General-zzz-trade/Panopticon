/**
 * Tool Synthesizer — generates new tools at runtime via LLM.
 *
 * When the agent encounters a task that no existing tool can handle,
 * the synthesizer:
 * 1. Asks the LLM to generate handler code (JavaScript/Python/Shell)
 * 2. Validates the code structure
 * 3. Registers it as a custom tool via the registry
 * 4. Returns the tool definition for immediate use
 *
 * Synthesized tools execute via `run_code` internally (Docker sandbox),
 * so they inherit sandboxing and resource limits.
 */

import { registerTool, getTool, type ToolDefinition, type ToolParameter } from "./registry";
import { readProviderConfig, callOpenAICompatible, callAnthropic, safeJsonParse } from "../llm/provider";
import { logModuleError } from "../core/module-logger";

export interface SynthesizedTool {
  definition: ToolDefinition;
  /** The generated code that implements this tool */
  code: string;
  /** Language of the generated code */
  language: "javascript" | "python" | "shell";
  /** Whether validation passed */
  validated: boolean;
}

// In-memory library of synthesized tools
const synthesizedTools = new Map<string, SynthesizedTool>();

const SYNTHESIS_PROMPT = `You are a tool generator for an OSINT reconnaissance agent. Given a task description that no existing tool can handle, generate a tool implementation.

Available context in the generated code:
- For JavaScript: You can use fetch() for HTTP, fs for files, child_process for shell
- The code receives a "params" object with the parameters you define
- The code must print its result to stdout as JSON: { "success": true, "result": "..." }

Return JSON:
{
  "name": "tool_name_in_snake_case",
  "description": "What this tool does",
  "category": "custom",
  "parameters": [{"name": "param1", "type": "string", "required": true, "description": "..."}],
  "language": "javascript",
  "code": "const params = JSON.parse(process.argv[2]); ... console.log(JSON.stringify({success: true, result: '...'}))"
}

Rules:
- Tool name must be unique and descriptive (snake_case)
- Code must be self-contained (no imports that aren't available in Node.js/Python stdlib)
- Code must handle errors gracefully
- Code must output JSON to stdout
- Keep it simple — one tool, one purpose`;

/**
 * Attempt to synthesize a new tool from a task description.
 * Returns the tool definition if successful, null if synthesis fails.
 */
export async function synthesizeTool(
  taskDescription: string,
  context?: string
): Promise<SynthesizedTool | null> {
  const config = readProviderConfig("LLM_RECOVERY", { maxTokens: 800 });
  if (!config.provider || !config.apiKey) return null;

  try {
    const messages = [
      { role: "system" as const, content: SYNTHESIS_PROMPT },
      { role: "user" as const, content: buildPrompt(taskDescription, context) }
    ];

    const result = config.provider === "anthropic"
      ? await callAnthropic(config, messages, "ToolSynthesizer")
      : await callOpenAICompatible(config, messages, "ToolSynthesizer");

    const parsed = safeJsonParse(result.content) as {
      name?: string;
      description?: string;
      category?: string;
      parameters?: ToolParameter[];
      language?: string;
      code?: string;
    } | null;

    if (!parsed?.name || !parsed?.code || !parsed?.description) {
      return null;
    }

    // Validate tool name doesn't conflict with builtins
    const name = parsed.name.replace(/[^a-z0-9_]/g, "_");
    if (getTool(name) && !synthesizedTools.has(name)) {
      return null; // Don't overwrite built-in tools
    }

    const language = (parsed.language as SynthesizedTool["language"]) || "javascript";
    const code = parsed.code;
    const parameters = (parsed.parameters ?? []).map(p => ({
      name: p.name,
      type: p.type || "string" as const,
      required: p.required ?? true,
      description: p.description || p.name
    }));

    if (!validateCodeStructure(code, language)) {
      return null;
    }

    const definition: ToolDefinition = {
      name,
      category: "custom",
      description: parsed.description,
      parameters,
      verificationStrategy: "error",
      mutating: true,
      requiresApproval: true // Synthesized tools always require approval
    };

    const synth: SynthesizedTool = {
      definition,
      code,
      language,
      validated: true
    };

    registerTool(definition);
    synthesizedTools.set(name, synth);

    return synth;
  } catch (error) {
    logModuleError("tool-synthesizer", "optional", error, "tool synthesis failed");
    return null;
  }
}

/**
 * Get a synthesized tool's code by name.
 */
export function getSynthesizedTool(name: string): SynthesizedTool | undefined {
  return synthesizedTools.get(name);
}

/**
 * List all synthesized tools.
 */
export function listSynthesizedTools(): SynthesizedTool[] {
  return Array.from(synthesizedTools.values());
}

/**
 * Build the code to execute a synthesized tool with given parameters.
 * Returns a string that can be passed to run_code handler.
 */
export function buildToolExecutionCode(
  tool: SynthesizedTool,
  params: Record<string, unknown>
): { language: string; code: string } {
  const paramsJson = JSON.stringify(params);

  if (tool.language === "javascript") {
    return {
      language: "javascript",
      code: `const __params = ${paramsJson};\n${tool.code.replace(/JSON\.parse\(process\.argv\[2\]\)/g, "__params")}`
    };
  }
  if (tool.language === "python") {
    return {
      language: "python",
      code: `import json\n__params = json.loads('${paramsJson}')\n${tool.code}`
    };
  }
  return { language: "shell", code: tool.code };
}

// ── Internals ───────────────────────────────────────────────────────────

function buildPrompt(description: string, context?: string): string {
  let prompt = `Create a tool for this task:\n\n${description}`;
  if (context) prompt += `\n\nAdditional context:\n${context}`;
  return prompt;
}

/**
 * Structural validation of generated code (not execution).
 * Checks for minimum viable structure without eval'ing the code.
 */
function validateCodeStructure(code: string, language: string): boolean {
  if (code.trim().length === 0) return false;
  if (code.length > 10000) return false; // Too large

  if (language === "javascript") {
    // Must produce JSON output to stdout
    if (!code.includes("console.log") && !code.includes("process.stdout")) return false;
    // Should have some structure
    if (!code.includes("{") || !code.includes("}")) return false;
    return true;
  }

  if (language === "python") {
    if (!code.includes("print") && !code.includes("sys.stdout")) return false;
    return true;
  }

  // Shell: just needs content
  return true;
}
