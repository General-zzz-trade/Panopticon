/**
 * Computer Use Handler — visual fallback for browser tasks.
 * Takes a screenshot, sends to Claude with the task description,
 * gets pixel coordinates, and executes the action via Playwright.
 *
 * Used as a fallback when CSS selector-based actions fail.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { RunContext } from "../types";
import type { AgentTask } from "../types";
import type { TaskExecutionOutput } from "./browser-handler";
import { Logger } from "../logger";
import { logModuleError } from "../core/module-logger";

const ANTHROPIC_MODEL = process.env.LLM_COMPUTER_USE_MODEL ?? "claude-sonnet-4-20250514";

export interface VisualActionResult {
  success: boolean;
  action: string;
  detail: string;
  coordinates?: { x: number; y: number };
}

/**
 * Check if computer-use handler is available (Anthropic API key configured).
 */
export function isVisualFallbackAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.LLM_RECOVERY_API_KEY);
}

/**
 * Execute a single browser task using visual perception (screenshot → Claude → action).
 */
export async function handleVisualBrowserTask(
  context: RunContext,
  task: AgentTask,
  logger: Logger = new Logger()
): Promise<TaskExecutionOutput> {
  if (!context.browserSession?.page) {
    return { summary: `Visual fallback skipped: no browser session available` };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.LLM_RECOVERY_API_KEY;
  if (!apiKey) {
    return { summary: `Visual fallback skipped: no API key configured` };
  }

  const page = context.browserSession.page;
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  // Take screenshot
  let screenshotBase64: string;
  try {
    const screenshotBuffer = await page.screenshot({ type: "png" });
    screenshotBase64 = screenshotBuffer.toString("base64");
  } catch (error) {
    logModuleError("computer-use-handler", "optional", error, "screenshot capture");
    return {
      summary: `Visual fallback skipped: screenshot failed`,
      stateHints: ["visual_fallback_screenshot_failed"]
    };
  }

  // Build prompt from task
  const description = buildTaskDescription(task);

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 256,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: screenshotBase64 }
        },
        {
          type: "text",
          text: `You are an OSINT browser agent. Look at this screenshot (${viewport.width}x${viewport.height}) and ${description}.\n\nRespond with JSON: { "action": "click"|"type", "x": number, "y": number, "text"?: string }`
        }
      ]
    }]
  });

  // Parse response
  const textBlock = response.content.find(b => b.type === "text");
  const responseText = textBlock && "text" in textBlock ? textBlock.text : "";
  const match = responseText.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      summary: `Visual fallback: Claude did not return valid coordinates`,
      stateHints: ["visual_fallback_parse_failed"]
    };
  }

  let action: { action: string; x: number; y: number; text?: string };
  try {
    action = JSON.parse(match[0]) as { action: string; x: number; y: number; text?: string };
  } catch {
    return {
      summary: `Visual fallback: failed to parse Claude response as JSON`,
      stateHints: ["visual_fallback_parse_failed"]
    };
  }

  logger.info(`Visual fallback: ${action.action} at (${action.x}, ${action.y})`);

  // Execute the action
  if (action.action === "click") {
    await page.mouse.click(action.x, action.y);
  } else if (action.action === "type" && action.text) {
    await page.mouse.click(action.x, action.y);
    await page.keyboard.type(action.text);
  }

  task.status = "done";
  task.endedAt = new Date().toISOString();

  return {
    summary: `Visual fallback: ${action.action} at (${action.x}, ${action.y})${action.text ? ` text="${action.text}"` : ""}`,
    stateHints: ["visual_fallback_used"]
  };
}

function buildTaskDescription(task: AgentTask): string {
  const desc = task.payload.description ?? task.payload.selector ?? "";
  switch (task.type) {
    case "click":
    case "visual_click":
      return `click on the element described as "${desc}"`;
    case "type":
    case "visual_type":
      return `click on the input field "${desc}" and type "${task.payload.text ?? ""}"`;
    case "select":
      return `select the option "${task.payload.value ?? ""}" in the dropdown "${desc}"`;
    default:
      return `perform ${task.type} on "${desc}"`;
  }
}
