import { FailurePattern } from "../memory";
import { RecentRunSummary } from "./diagnoser";
import { AgentAction } from "../types";
import { TaskBlueprint } from "../planner/task-id";
import {
  LLMProviderConfig,
  callOpenAICompatible,
  callAnthropic,
  readProviderConfig,
  safeJsonParse,
  unwrapTasksPayload
} from "./provider";
import { buildKnowledgeContext, buildPlanningPriors, extractDomainFromGoal } from "../knowledge/planner-context";

export type LLMPlannerConfig = LLMProviderConfig;

export interface LLMPlannerInput {
  goal: string;
  recentRunsSummary: RecentRunSummary[];
  failurePatterns: FailurePattern[];
}

export interface LLMPlanner {
  readonly config: LLMPlannerConfig;
  plan(input: LLMPlannerInput): Promise<TaskBlueprint[]>;
}

export const ALLOWED_PLANNER_TASK_TYPES = new Set<AgentAction>([
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

const PLANNER_SYSTEM_PROMPT =
  "You are a constrained UI test planner. Return JSON only. Output {\"tasks\":[...]} where each task uses only allowed types: start_app, wait_for_server, open_page, click, type, select, scroll, hover, wait, assert_text, screenshot, stop_app. Keep payloads minimal and executable.";

export function createPlannerFromEnv(): LLMPlanner | undefined {
  const config = readProviderConfig("LLM_PLANNER", { maxTokens: 600 });
  if (!config.provider) {
    return undefined;
  }

  if (config.provider === "mock") {
    return createMockPlanner(config);
  }

  if (config.provider === "openai-compatible") {
    if (!config.apiKey || !config.baseUrl) {
      return undefined;
    }

    return createOpenAICompatiblePlanner(config);
  }

  if (config.provider === "anthropic") {
    if (!config.apiKey) {
      return undefined;
    }

    return createAnthropicPlanner(config);
  }

  return undefined;
}

export function validateLLMPlannerOutput(tasks: TaskBlueprint[]): boolean {
  return tasks.every((task) => ALLOWED_PLANNER_TASK_TYPES.has(task.type));
}

function createMockPlanner(config: LLMPlannerConfig): LLMPlanner {
  return {
    config,
    async plan(input: LLMPlannerInput): Promise<TaskBlueprint[]> {
      // Use raw goal for pattern matching; knowledge context is informational
      const goal = input.goal;
      const command =
        extractQuotedValue(goal, /(?:start app|run app|launch app|boot app)\s+"([^"]+)"/i) ??
        extractQuotedValue(goal, /using\s+"([^"]+)"/i);
      const url = extractUrl(goal);

      if (/delayed login/i.test(goal) && command && url) {
        return [
          { type: "start_app", payload: { command } },
          { type: "wait_for_server", payload: { url, timeoutMs: 30000 } },
          { type: "open_page", payload: { url } },
          { type: "click", payload: { selector: "#delayed-login-button" } },
          { type: "assert_text", payload: { text: "Dashboard", timeoutMs: 1000 } },
          { type: "screenshot", payload: { outputPath: "artifacts/llm-delayed-login.png" } },
          { type: "stop_app", payload: {} }
        ];
      }

      if (/login/i.test(goal) && command && url) {
        return [
          { type: "start_app", payload: { command } },
          { type: "wait_for_server", payload: { url, timeoutMs: 30000 } },
          { type: "open_page", payload: { url } },
          { type: "click", payload: { selector: "#login-button" } },
          { type: "assert_text", payload: { text: "Dashboard", timeoutMs: 5000 } },
          { type: "stop_app", payload: {} }
        ];
      }

      if (url && /capture|screenshot/i.test(goal)) {
        return [
          { type: "open_page", payload: { url } },
          { type: "screenshot", payload: { outputPath: "artifacts/llm-page.png" } }
        ];
      }

      return [];
    }
  };
}

function createOpenAICompatiblePlanner(config: LLMPlannerConfig): LLMPlanner {
  return {
    config,
    async plan(input: LLMPlannerInput): Promise<TaskBlueprint[]> {
      const domain = extractDomainFromGoal(input.goal);
      const knowledgeContext = buildKnowledgeContext(input.goal, domain);
      const planningPriors = buildPlanningPriors(input.goal, domain);

      const { content: raw } = await callOpenAICompatible(
        config,
        [
          { role: "system", content: PLANNER_SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              goal: input.goal,
              knowledgeContext,
              planningPriors,
              recentRunsSummary: input.recentRunsSummary,
              failurePatterns: input.failurePatterns
            })
          }
        ],
        "LLM planner"
      );

      const parsed = safeJsonParse(unwrapTasksPayload(raw));

      if (!Array.isArray(parsed)) {
        throw new Error("LLM planner response was not a JSON task array.");
      }

      return parsed
        .map((item) => normalizeTaskBlueprint(item))
        .filter((item): item is TaskBlueprint => item !== undefined);
    }
  };
}

function createAnthropicPlanner(config: LLMPlannerConfig): LLMPlanner {
  return {
    config,
    async plan(input: LLMPlannerInput): Promise<TaskBlueprint[]> {
      const domain = extractDomainFromGoal(input.goal);
      const knowledgeContext = buildKnowledgeContext(input.goal, domain);
      const planningPriors = buildPlanningPriors(input.goal, domain);

      const { content: raw } = await callAnthropic(
        config,
        [
          { role: "system", content: PLANNER_SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              goal: input.goal,
              knowledgeContext,
              planningPriors,
              recentRunsSummary: input.recentRunsSummary,
              failurePatterns: input.failurePatterns
            })
          }
        ],
        "LLM planner"
      );

      const parsed = safeJsonParse(unwrapTasksPayload(raw));

      if (!Array.isArray(parsed)) {
        throw new Error("LLM planner response was not a JSON task array.");
      }

      return parsed
        .map((item) => normalizeTaskBlueprint(item))
        .filter((item): item is TaskBlueprint => item !== undefined);
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

  if (typeof candidate.type !== "string" || !ALLOWED_PLANNER_TASK_TYPES.has(candidate.type as AgentAction)) {
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

function extractUrl(value: string): string | undefined {
  const match = value.match(/https?:\/\/[^\s"]+/i);
  return match?.[0];
}

function extractQuotedValue(value: string, pattern: RegExp): string | undefined {
  const match = value.match(pattern);
  return match?.[1];
}
