/**
 * ReAct Loop — Reasoning + Acting execution mode.
 *
 * Instead of planning all tasks upfront, the agent:
 * 1. Observes the current page state
 * 2. Asks the LLM "what should I do next to achieve the goal?"
 * 3. Executes the single action the LLM suggests
 * 4. Observes the result
 * 5. Repeats until the LLM says the goal is achieved or max steps reached
 *
 * This enables handling of goals the regex/template planners can't parse,
 * and adapts dynamically to unexpected page states.
 */

import { readProviderConfig, callOpenAICompatible, callAnthropic, safeJsonParse } from "../llm/provider";
import type { LLMMessage } from "../llm/provider";
import { observeEnvironment } from "../cognition/observation-engine";
import { executeTask } from "./executor";
import { createBrowserSession, closeBrowserSession } from "../browser";
import type { BrowserSession } from "../browser";
import { createUsageLedger } from "../observability/usage-ledger";
import { publishEvent, closeEmitter } from "../streaming/event-bus";
import type { AgentTask, AgentAction, RunContext } from "../types";

export interface ReactOptions {
  maxSteps?: number;
  tenantId?: string;
  browserSession?: BrowserSession;
  keepBrowserAlive?: boolean;
}

export interface ReactStep {
  step: number;
  thought: string;
  action: AgentAction;
  payload: Record<string, string | number | boolean | undefined>;
  result: string;
  success: boolean;
}

export interface ReactResult {
  runId: string;
  goal: string;
  success: boolean;
  message: string;
  steps: ReactStep[];
  totalSteps: number;
}

/**
 * Check if ReAct mode is available (LLM configured).
 */
export function isReactConfigured(): boolean {
  const config = readProviderConfig("LLM_REACT", { maxTokens: 800, temperature: 0 });
  return Boolean(config.provider && config.apiKey);
}

/**
 * Run a goal using the ReAct loop.
 * The LLM decides each action step by step.
 */
export async function runReactGoal(goal: string, options: ReactOptions = {}): Promise<ReactResult> {
  const maxSteps = options.maxSteps ?? 20;
  const runId = `react-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const config = readProviderConfig("LLM_REACT", { maxTokens: 800, temperature: 0 });
  const steps: ReactStep[] = [];
  const conversationHistory: LLMMessage[] = [];

  // Build minimal RunContext for executor and observation
  const context: RunContext = {
    runId,
    tenantId: options.tenantId ?? "default",
    goal,
    tasks: [],
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: 0,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    escalationDecisions: [],
    limits: { maxReplansPerRun: 0, maxReplansPerTask: 0 },
    startedAt: new Date().toISOString(),
    browserSession: options.browserSession,
    usageLedger: createUsageLedger()
  };

  const systemPrompt = buildReactSystemPrompt();
  conversationHistory.push({ role: "system", content: systemPrompt });

  try {
    for (let step = 0; step < maxSteps; step++) {
      // 1. Observe
      const observation = await observeEnvironment(context);

      // 2. Think — ask LLM what to do
      const observationSummary = formatObservation(observation, goal, steps);
      conversationHistory.push({ role: "user", content: observationSummary });

      const llmResponse = await callLLM(config, conversationHistory);
      if (!llmResponse) {
        return { runId, goal, success: false, message: "LLM failed to respond", steps, totalSteps: step };
      }

      conversationHistory.push({ role: "user", content: `Assistant response: ${llmResponse}` });

      // 3. Parse the action
      const parsed = parseReactAction(llmResponse);
      if (!parsed) {
        return { runId, goal, success: false, message: `LLM returned unparseable action: ${llmResponse.slice(0, 200)}`, steps, totalSteps: step };
      }

      // Check if goal is achieved
      if (parsed.done) {
        return {
          runId,
          goal,
          success: true,
          message: parsed.thought,
          steps,
          totalSteps: step
        };
      }

      // 4. Act — execute the single action
      const task = createTaskFromAction(runId, step, parsed);
      context.tasks.push(task);
      context.nextTaskSequence = step + 1;

      let result = "";
      let success = false;

      try {
        // Ensure browser is available for browser actions
        if (needsBrowser(task.type) && !context.browserSession) {
          context.browserSession = await createBrowserSession();
        }

        const output = await executeTask(context, task);
        result = output.summary;
        success = true;
      } catch (error) {
        result = error instanceof Error ? error.message : "Action failed";
        success = false;
      }

      steps.push({
        step,
        thought: parsed.thought,
        action: task.type,
        payload: task.payload,
        result,
        success
      });

      publishEvent({
        type: success ? "task_done" : "task_failed",
        runId,
        taskId: task.id,
        timestamp: new Date().toISOString(),
        summary: `[Step ${step}] ${parsed.thought} → ${task.type}: ${result}`
      });
    }

    return {
      runId,
      goal,
      success: false,
      message: `Reached maximum steps (${maxSteps}) without completing goal`,
      steps,
      totalSteps: maxSteps
    };
  } finally {
    if (!options.keepBrowserAlive) {
      await closeBrowserSession(context.browserSession);
    }
    closeEmitter(runId);
  }
}

function buildReactSystemPrompt(): string {
  return `You are an autonomous web agent. You interact with web pages to achieve goals.

At each step, you observe the page state and decide what to do next.

Respond with JSON only:
{
  "thought": "your reasoning about what you see and what to do",
  "action": "open_page" | "click" | "type" | "select" | "scroll" | "wait" | "screenshot" | "assert_text" | "hover" | "visual_click" | "visual_type",
  "payload": { action-specific parameters },
  "done": false
}

When the goal is achieved, respond:
{
  "thought": "explanation of why the goal is complete",
  "action": "none",
  "payload": {},
  "done": true
}

Action payloads:
- open_page: { "url": "..." }
- click: { "selector": "..." }
- type: { "selector": "...", "text": "..." }
- select: { "selector": "...", "value": "..." }
- scroll: { "direction": "down" | "up" }
- wait: { "ms": 1000 }
- screenshot: { "outputPath": "artifacts/screenshot.png" }
- assert_text: { "text": "..." }
- hover: { "selector": "..." }
- visual_click: { "description": "..." }
- visual_type: { "description": "...", "value": "..." }

Be methodical: observe carefully, act precisely, verify results. Use CSS selectors when visible; use visual_ actions when selectors are unclear.`;
}

function formatObservation(
  observation: any,
  goal: string,
  previousSteps: ReactStep[]
): string {
  const parts: string[] = [];
  parts.push(`Goal: ${goal}`);
  parts.push(`Page URL: ${observation.pageUrl ?? "no page open"}`);
  parts.push(`Page title: ${observation.title ?? "unknown"}`);

  if (observation.visibleText?.length > 0) {
    parts.push(`Visible text:\n${observation.visibleText.slice(0, 10).join("\n")}`);
  }

  if (observation.actionableElements?.length > 0) {
    parts.push(`Actionable elements:`);
    for (const el of observation.actionableElements.slice(0, 10)) {
      parts.push(`  - ${el.role ?? "element"}: "${el.text ?? ""}" selector="${el.selector ?? "?"}" `);
    }
  }

  if (observation.sceneDescription) {
    parts.push(`Page type: ${observation.sceneDescription.pageType}`);
    if (observation.sceneDescription.stateIndicators?.length > 0) {
      parts.push(`State: ${observation.sceneDescription.stateIndicators.join(", ")}`);
    }
  }

  if (previousSteps.length > 0) {
    const recent = previousSteps.slice(-3);
    parts.push(`\nRecent actions:`);
    for (const s of recent) {
      parts.push(`  [${s.step}] ${s.thought.slice(0, 80)} → ${s.action}: ${s.success ? "OK" : "FAIL"} ${s.result.slice(0, 60)}`);
    }
  }

  parts.push(`\nWhat should we do next?`);
  return parts.join("\n");
}

async function callLLM(config: ReturnType<typeof readProviderConfig>, messages: LLMMessage[]): Promise<string | null> {
  try {
    const result = config.provider === "anthropic"
      ? await callAnthropic(config, messages, "ReAct")
      : await callOpenAICompatible(config, messages, "ReAct");
    return result.content;
  } catch {
    return null;
  }
}

interface ParsedReactAction {
  thought: string;
  action: string;
  payload: Record<string, unknown>;
  done: boolean;
}

function parseReactAction(content: string): ParsedReactAction | null {
  const parsed = safeJsonParse(content);
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.thought !== "string") return null;
  if (typeof obj.done !== "boolean") return null;

  if (obj.done) {
    return { thought: obj.thought, action: "none", payload: {}, done: true };
  }

  if (typeof obj.action !== "string") return null;

  return {
    thought: obj.thought,
    action: obj.action,
    payload: (obj.payload as Record<string, unknown>) ?? {},
    done: false
  };
}

function createTaskFromAction(
  runId: string,
  step: number,
  parsed: ParsedReactAction
): AgentTask {
  const payload: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(parsed.payload)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      payload[key] = value;
    }
  }

  return {
    id: `${runId}-step-${step}`,
    type: parsed.action as AgentAction,
    status: "pending",
    retries: 0,
    attempts: 0,
    replanDepth: 0,
    payload
  };
}

function needsBrowser(action: string): boolean {
  const browserActions = [
    "open_page", "click", "type", "select", "scroll", "hover",
    "screenshot", "assert_text", "visual_click", "visual_type",
    "visual_assert", "visual_extract"
  ];
  return browserActions.includes(action);
}
