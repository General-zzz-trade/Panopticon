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
  "stop_app",
  "http_request",
  "run_code",
  "read_file"
]);

const REPLANNER_SYSTEM_PROMPT = `You are a constrained UI test replanner. Your job is to produce a small set of remedial steps to recover from a failed task.

## Output Format
Return JSON only. Output {"tasks":[...]} where each task has "type" and "payload" fields.

## Allowed Task Types

| Type | Description | Required Payload Fields |
|------|-------------|----------------------|
| start_app | Launch a local application process | command |
| wait_for_server | Wait for a URL to become reachable | url, timeoutMs |
| open_page | Navigate browser to a URL | url |
| click | Click an element by CSS selector | selector |
| type | Type text into an input element | selector, text |
| select | Select an option from a dropdown | selector, value |
| scroll | Scroll the page or an element | direction (up/down), amount? |
| hover | Hover over an element | selector |
| wait | Wait for a fixed duration | durationMs |
| assert_text | Assert text is visible on page | text, timeoutMs? |
| screenshot | Capture a screenshot | outputPath? |
| stop_app | Stop a running application | (none) |
| http_request | Make an HTTP request | url, method, body?, headers? |
| run_code | Execute code or shell command | code, language (javascript/shell) |
| read_file | Read contents of a file | path |

## Common Failure Patterns and Recovery Strategies

1. **Selector not found / timeout**: The element may have changed. Try alternative selectors:
   - Prefer \`[data-testid="..."]\` attributes (most stable)
   - Use \`[aria-label="..."]\` for accessible elements
   - Use text content selectors: \`text=Submit\`, \`button:has-text("Submit")\`
   - Try parent/child relationships if direct selector fails
   - Add a \`wait\` step before retrying if the element may not have loaded yet

2. **Navigation timeout**: The page may be slow to load.
   - Increase timeoutMs on wait_for_server
   - Add a wait step before the navigation
   - Check if the URL is correct

3. **Assertion failure**: The expected text may differ or not yet be visible.
   - Add a wait step before the assertion
   - Increase the assertion timeoutMs
   - Check for partial text matches or alternate wording

4. **State not ready**: The application may need time to initialize.
   - Add wait steps between actions
   - Verify server is ready before interacting with UI
   - Re-navigate to the page if state is stale

5. **Session / target closed**: The browser tab or context was lost.
   - Re-open the page with open_page
   - Re-establish application state from scratch

## Rules

1. Produce MINIMAL steps — only what is needed to recover from the specific failure.
2. NEVER repeat the exact same approach that already failed. Change selectors, add waits, or try alternative strategies.
3. If a selector failed, always try a DIFFERENT selector strategy (data-testid, aria-label, text content, or structural).
4. Prefer adding a short wait (500-2000ms) before retrying interactive steps if timing may be the issue.
5. Do not include tasks that already succeeded — only produce the recovery steps.
6. Keep the total number of tasks under 5 for any single replan.`;

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
