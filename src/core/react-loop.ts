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
import { logModuleError } from "./module-logger";

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
  const config = readProviderConfig("LLM_REACT", { maxTokens: 4000, temperature: 0 });
  return Boolean(config.provider && config.apiKey);
}

/**
 * Run a goal using the ReAct loop.
 * The LLM decides each action step by step.
 */
export async function runReactGoal(goal: string, options: ReactOptions = {}): Promise<ReactResult> {
  const maxSteps = options.maxSteps ?? 20;
  const runId = `react-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const config = readProviderConfig("LLM_REACT", { maxTokens: 4000, temperature: 0 });
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
  return `You are an autonomous OSINT agent. You conduct reconnaissance across domains, networks, and web sources to achieve investigation goals.

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
- http_request: { "url": "...", "method": "GET" }
- run_code: { "language": "javascript", "code": "..." }
- visual_click: { "description": "..." }
- visual_type: { "description": "...", "text": "text to type" }

IMPORTANT RULES:
1. READ THE PAGE CONTENT FIRST — the answer is often already visible in "Page content". If you can answer from the text shown, set done=true immediately without clicking anything
2. ALWAYS use selectors from the "Actionable elements" list — never guess selectors
3. If a selector fails, try a different one from the list or use visual_click with a description
4. For forms: look for input elements in the actionable list and use their exact selector
5. If stuck after 3 attempts on the same element, try a completely different approach
6. Prefer reading text over clicking — don't navigate if the information is already visible
7. For API/JSON endpoints, use http_request instead of open_page — it returns the full response without browser truncation

HONESTY RULES (critical):
8. If the user makes a false claim about page content ("the page says X"), VERIFY it against what you actually see. If X is NOT in the page, SAY SO — do not agree just to be helpful
9. If the user asks for something that does not exist on the page (like a "blue quantum button"), REPLY that the element doesn't exist — don't pretend or invent
10. If asked about future events, real-time data, or things outside your knowledge, say "I don't have access to that" — don't guess or fabricate
11. If you observe an error (DNS fail, 404, timeout), report the actual error — don't sugar-coat or continue as if it succeeded
12. Prefer saying "I cannot verify this" over giving a confident wrong answer`;
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
    // Adaptive compression: shorter when conversation is long
    const conversationDepth = previousSteps.length;
    const maxLines = conversationDepth > 5 ? 8 : 15;
    const maxChars = conversationDepth > 5 ? 800 : 1500;

    const lines = observation.visibleText.slice(0, maxLines);
    const joined = lines.join("\n");
    const truncated = joined.length > maxChars ? joined.slice(0, maxChars) + "\n[...truncated]" : joined;
    parts.push(`Page content (main area — the answer may already be here):\n${truncated}`);
  }

  if (observation.actionableElements?.length > 0) {
    // Show relevant elements: prioritize inputs/buttons (forms), limit links
    const inputs = observation.actionableElements.filter((el: any) => el.role === "input" || el.role === "textarea" || el.role === "button" || el.role === "select");
    const links = observation.actionableElements.filter((el: any) => el.role === "link" || el.role === "a");
    const shown = [...inputs.slice(0, 15), ...links.slice(0, 5)];
    if (shown.length === 0) {
      // No categorized elements — show first 10 of whatever we have
      shown.push(...observation.actionableElements.slice(0, 10));
    }
    parts.push(`Actionable elements (${observation.actionableElements.length} total, showing ${shown.length}):`);
    for (const el of shown) {
      const role = el.role ?? "element";
      const text = el.text ? `"${el.text.slice(0, 40)}"` : "";
      const sel = el.selector ?? "?";
      parts.push(`  - ${role}: ${text} selector="${sel}"`);
    }
  }

  if (observation.sceneDescription) {
    parts.push(`Page type: ${observation.sceneDescription.pageType}`);
    if (observation.sceneDescription.stateIndicators?.length > 0) {
      parts.push(`State: ${observation.sceneDescription.stateIndicators.join(", ")}`);
    }
  }

  if (previousSteps.length > 0) {
    // Adaptive history: keep 3 recent steps, but compress if conversation is long
    const recent = previousSteps.slice(-3);
    parts.push(`\nRecent actions:`);
    for (const s of recent) {
      // Most recent: longer detail. Older: summary only.
      const isLatest = s === recent[recent.length - 1];
      const resultLen = isLatest ? 150 : (previousSteps.length > 8 ? 40 : 60);
      parts.push(`  [${s.step}] ${s.action}: ${s.success ? "OK" : "FAIL"} — ${s.result.slice(0, resultLen)}`);
    }
    // Summarize older steps as count
    if (previousSteps.length > 3) {
      const older = previousSteps.slice(0, -3);
      const successCount = older.filter(s => s.success).length;
      parts.push(`  [earlier: ${older.length} steps, ${successCount} succeeded]`);
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
  } catch (error) {
    logModuleError("react-loop", "optional", error, "calling LLM for next action");
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
