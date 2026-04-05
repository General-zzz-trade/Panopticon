import { logModuleError } from "../core/module-logger";
import { FailurePattern } from "../memory";
import { RecentRunSummary } from "./diagnoser";
import { AgentAction, AgentTask } from "../types";
import { TaskBlueprint } from "../planner/task-id";
import {
  LLMProviderConfig,
  callOpenAICompatible,
  callAnthropic,
  readProviderConfig,
  safeJsonParse,
  unwrapTasksPayload
} from "./provider";
import { selectPrompt, recordPromptOutcome } from "../learning/prompt-evolver";

export type LLMReplannerConfig = LLMProviderConfig;

export interface LLMReplannerInput {
  goal: string;
  currentTask: AgentTask;
  currentError: string;
  recentRunsSummary: RecentRunSummary[];
  failurePatterns: FailurePattern[];
  currentTaskListSnapshot: AgentTask[];
}

export interface LLMReplanner {
  readonly config: LLMReplannerConfig;
  replan(input: LLMReplannerInput): Promise<TaskBlueprint[]>;
}

export const ALLOWED_REPLANNER_TASK_TYPES = new Set<AgentAction>([
  "start_app",
  "wait_for_server",
  "open_page",
  "click",
  "type",
  "select",
  "scroll",
  "hover",
  "wait",
  "assert_text",
  "screenshot",
  "stop_app"
]);

const REPLANNER_SYSTEM_PROMPT =
  "You are a constrained UI test replanner. Return JSON only. Output {\"tasks\":[...]} where each task uses only allowed types: start_app, wait_for_server, open_page, click, type, select, scroll, hover, wait, assert_text, screenshot, stop_app. Produce only small remedial steps.";

export function createReplannerFromEnv(): LLMReplanner | undefined {
  const config = readProviderConfig("LLM_REPLANNER", { maxTokens: 400 });
  if (!config.provider) {
    return undefined;
  }

  if (config.provider === "mock") {
    return createMockReplanner(config);
  }

  if (config.provider === "openai-compatible") {
    if (!config.apiKey || !config.baseUrl) {
      return undefined;
    }

    return createOpenAICompatibleReplanner(config);
  }

  if (config.provider === "anthropic") {
    if (!config.apiKey) {
      return undefined;
    }

    return createAnthropicReplanner(config);
  }

  return undefined;
}

export function validateLLMReplannerOutput(tasks: TaskBlueprint[]): boolean {
  return tasks.every((task) => ALLOWED_REPLANNER_TASK_TYPES.has(task.type));
}

function createMockReplanner(config: LLMReplannerConfig): LLMReplanner {
  return {
    config,
    async replan(input: LLMReplannerInput): Promise<TaskBlueprint[]> {
      const goal = input.goal;

      if (input.currentTask.type === "click" && /#wrong-button|not found|timeout/i.test(`${input.currentTask.payload.selector ?? ""} ${input.currentError}`)) {
        if (/delayed/i.test(goal)) {
          return [
            { type: "wait", payload: { durationMs: 1000 } },
            { type: "click", payload: { selector: "#delayed-login-button" } }
          ];
        }

        if (/login|dashboard/i.test(goal)) {
          return [
            { type: "wait", payload: { durationMs: 1000 } },
            { type: "click", payload: { selector: "#login-button" } }
          ];
        }
      }

      if (input.currentTask.type === "assert_text" && /dashboard/i.test(goal) && /timeout|visible/i.test(input.currentError)) {
        return [
          { type: "wait", payload: { durationMs: 1500 } },
          { type: "assert_text", payload: { text: "Dashboard", timeoutMs: 2000 } }
        ];
      }

      if (input.currentTask.type === "wait_for_server" && /did not become available|timeout/i.test(input.currentError)) {
        return [
          {
            type: "wait_for_server",
            payload: {
              url: String(input.currentTask.payload.url ?? ""),
              timeoutMs: Math.max(Number(input.currentTask.payload.timeoutMs ?? 30000) + 5000, 35000)
            }
          }
        ];
      }

      return [];
    }
  };
}

function createOpenAICompatibleReplanner(config: LLMReplannerConfig): LLMReplanner {
  return {
    config,
    async replan(input: LLMReplannerInput): Promise<TaskBlueprint[]> {
      let selectedPrompt: { id: string; systemPrompt: string } | undefined;
      if (!process.env.DISABLE_PROMPT_EVOLUTION) try {
        selectedPrompt = selectPrompt("replanner") ?? undefined;
      } catch (error) { logModuleError("replanner", "optional", error, "prompt selection"); }
      const systemPrompt = selectedPrompt?.systemPrompt ?? REPLANNER_SYSTEM_PROMPT;

      let raw: string;
      try {
        const result = await callOpenAICompatible(
          config,
          [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: JSON.stringify({
                goal: input.goal,
                currentTask: input.currentTask,
                currentError: input.currentError,
                recentRunsSummary: input.recentRunsSummary,
                failurePatterns: input.failurePatterns,
                currentTaskListSnapshot: input.currentTaskListSnapshot
              })
            }
          ],
          "LLM replanner"
        );
        raw = result.content;
      } catch (err) {
        if (selectedPrompt) {
          try { recordPromptOutcome(selectedPrompt.id, false); } catch (error) { logModuleError("replanner", "optional", error, "recording prompt outcome on call failure"); }
        }
        throw err;
      }

      const parsed = safeJsonParse(unwrapTasksPayload(raw));

      if (!Array.isArray(parsed)) {
        if (selectedPrompt) {
          try { recordPromptOutcome(selectedPrompt.id, false); } catch (error) { logModuleError("replanner", "optional", error, "recording prompt outcome on parse failure"); }
        }
        throw new Error("LLM replanner response was not a JSON task array.");
      }

      const tasks = parsed
        .map((item) => normalizeTaskBlueprint(item))
        .filter((item): item is TaskBlueprint => item !== undefined);

      if (selectedPrompt) {
        try { recordPromptOutcome(selectedPrompt.id, tasks.length > 0); } catch (error) { logModuleError("replanner", "optional", error, "recording prompt outcome"); }
      }

      return tasks;
    }
  };
}

function createAnthropicReplanner(config: LLMReplannerConfig): LLMReplanner {
  return {
    config,
    async replan(input: LLMReplannerInput): Promise<TaskBlueprint[]> {
      let selectedPrompt: { id: string; systemPrompt: string } | undefined;
      if (!process.env.DISABLE_PROMPT_EVOLUTION) try {
        selectedPrompt = selectPrompt("replanner") ?? undefined;
      } catch (error) { logModuleError("replanner", "optional", error, "prompt selection"); }
      const systemPrompt = selectedPrompt?.systemPrompt ?? REPLANNER_SYSTEM_PROMPT;

      let raw: string;
      try {
        const result = await callAnthropic(
          config,
          [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: JSON.stringify({
                goal: input.goal,
                currentTask: input.currentTask,
                currentError: input.currentError,
                recentRunsSummary: input.recentRunsSummary,
                failurePatterns: input.failurePatterns,
                currentTaskListSnapshot: input.currentTaskListSnapshot
              })
            }
          ],
          "LLM replanner"
        );
        raw = result.content;
      } catch (err) {
        if (selectedPrompt) {
          try { recordPromptOutcome(selectedPrompt.id, false); } catch (error) { logModuleError("replanner", "optional", error, "recording prompt outcome on call failure"); }
        }
        throw err;
      }

      const parsed = safeJsonParse(unwrapTasksPayload(raw));

      if (!Array.isArray(parsed)) {
        if (selectedPrompt) {
          try { recordPromptOutcome(selectedPrompt.id, false); } catch (error) { logModuleError("replanner", "optional", error, "recording prompt outcome on parse failure"); }
        }
        throw new Error("LLM replanner response was not a JSON task array.");
      }

      const tasks = parsed
        .map((item) => normalizeTaskBlueprint(item))
        .filter((item): item is TaskBlueprint => item !== undefined);

      if (selectedPrompt) {
        try { recordPromptOutcome(selectedPrompt.id, tasks.length > 0); } catch (error) { logModuleError("replanner", "optional", error, "recording prompt outcome"); }
      }

      return tasks;
    }
  };
}

function normalizeTaskBlueprint(value: unknown): TaskBlueprint | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as {
    type?: unknown;
    payload?: unknown;
  };

  if (typeof candidate.type !== "string" || !ALLOWED_REPLANNER_TASK_TYPES.has(candidate.type as AgentAction)) {
    return undefined;
  }

  if (!candidate.payload || typeof candidate.payload !== "object" || Array.isArray(candidate.payload)) {
    return undefined;
  }

  const payload = Object.fromEntries(
    Object.entries(candidate.payload).filter(([, item]) => {
      return typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === undefined;
    })
  );

  return {
    type: candidate.type as AgentAction,
    payload
  };
}
