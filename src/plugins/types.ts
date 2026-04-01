import type { RunContext, AgentTask } from "../types";

export interface ActionOutput {
  summary: string;
  artifacts?: Array<{ type: string; path: string; description: string }>;
}

export interface PluginActionHandler {
  /** The action type identifier (e.g. "upload_file", "call_api") */
  type: string;
  /** Human-readable description */
  description: string;
  /** Required payload fields and their types */
  payloadSchema: Record<string, "string" | "number" | "boolean">;
  /** Execute the action */
  execute(context: RunContext, task: AgentTask): Promise<ActionOutput>;
}

export interface AgentPlugin {
  /** Plugin name (must be unique) */
  name: string;
  /** Plugin version */
  version: string;
  /** Action handlers provided by this plugin */
  actions: PluginActionHandler[];
}
