/**
 * Claude Computer Use Agent — lets Claude directly see and control the browser.
 *
 * Instead of the agent parsing DOM or using CSS selectors, Claude:
 * 1. Sees a screenshot of the browser
 * 2. Decides what to click/type/scroll (at pixel coordinates)
 * 3. We execute the action via Playwright
 * 4. Take a new screenshot and send it back
 * 5. Repeat until Claude says it's done
 *
 * This is the most powerful execution mode — Claude reasons visually.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { BrowserSession } from "../browser";
import { createBrowserSession, openPage, closeBrowserSession } from "../browser";
import { publishEvent, closeEmitter } from "../streaming/event-bus";
import { saveEpisode, initEpisodesTable } from "../memory/episode-store";
import { computeEmbedding } from "../memory/embedding";
import { extractCausalTransitions } from "../world-model/extractor";
import { createCausalGraph } from "../world-model/causal-graph";
import { saveCausalGraph } from "../world-model/persistence";
import type { RunContext } from "../types";
import { logModuleError } from "../core/module-logger";

export interface ComputerUseOptions {
  maxSteps?: number;
  startUrl?: string;
  keepBrowserAlive?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface ComputerUseStep {
  step: number;
  action: string;
  detail: string;
  screenshotTaken: boolean;
}

export interface ComputerUseResult {
  runId: string;
  goal: string;
  success: boolean;
  message: string;
  steps: ComputerUseStep[];
  totalSteps: number;
  totalTokens: { input: number; output: number };
}

/**
 * Check if Computer Use is available.
 */
export function isComputerUseConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Run a goal using Claude Computer Use.
 * Claude sees screenshots and controls the browser directly.
 */
export async function runComputerUseGoal(
  goal: string,
  options: ComputerUseOptions = {}
): Promise<ComputerUseResult> {
  const maxSteps = options.maxSteps ?? 30;
  const width = options.viewportWidth ?? 1280;
  const height = options.viewportHeight ?? 800;
  const runId = `cu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const client = new Anthropic();
  const steps: ComputerUseStep[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let session: BrowserSession | undefined;

  try {
    // Launch browser with specific viewport
    session = await createBrowserSession();
    await session.page.setViewportSize({ width, height });

    // Navigate to start URL if provided
    if (options.startUrl) {
      await openPage(session, options.startUrl);
      await session.page.waitForTimeout(1000);
    }

    // Auto-dismiss dialogs
    session.page.on("dialog", async (dialog) => {
      try { await dialog.accept(); } catch (error) { logModuleError("computer-use-agent", "optional", error, "auto-dismissing dialog"); }
    });

    // Take initial screenshot
    let screenshotBase64 = await takeScreenshotBase64(session, width, height);

    // Build initial messages
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: goal
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: screenshotBase64
            }
          }
        ]
      }
    ];

    const tools: Anthropic.Beta.Messages.BetaToolUnion[] = [
      {
        type: "computer_20250124",
        name: "computer",
        display_width_px: width,
        display_height_px: height
      }
    ];

    // Main loop
    for (let step = 0; step < maxSteps; step++) {
      const response = await client.beta.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
        max_tokens: 4096,
        tools,
        messages,
        betas: ["computer-use-2025-01-24"]
      });

      totalInput += response.usage?.input_tokens ?? 0;
      totalOutput += response.usage?.output_tokens ?? 0;

      // Check if Claude is done (text response, no tool use)
      if (response.stop_reason === "end_turn") {
        const textBlocks = response.content.filter(b => b.type === "text");
        const finalMessage = textBlocks.map(b => (b as any).text).join("\n") || "Goal completed.";

        return {
          runId, goal, success: true, message: finalMessage,
          steps, totalSteps: step,
          totalTokens: { input: totalInput, output: totalOutput }
        };
      }

      // Process tool use blocks
      const toolUseBlocks = response.content.filter(b => b.type === "tool_use");
      if (toolUseBlocks.length === 0) {
        const textBlocks = response.content.filter(b => b.type === "text");
        const msg = textBlocks.map(b => (b as any).text).join("\n") || "No action taken.";
        return {
          runId, goal, success: true, message: msg,
          steps, totalSteps: step,
          totalTokens: { input: totalInput, output: totalOutput }
        };
      }

      // Add assistant response to messages
      messages.push({ role: "assistant", content: response.content as any });

      // Execute each tool use and collect results
      const toolResults: any[] = [];

      for (const block of toolUseBlocks) {
        const toolUse = block as any;
        const input = toolUse.input as Record<string, unknown>;
        const action = String(input.action ?? "unknown");

        let detail = "";

        try {
          detail = await executeComputerAction(session, input, width, height);
          steps.push({ step, action, detail, screenshotTaken: true });

          // Take screenshot after action
          await session.page.waitForTimeout(500);
          screenshotBase64 = await takeScreenshotBase64(session, width, height);

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: screenshotBase64
                }
              }
            ]
          });

          publishEvent({
            type: "task_done",
            runId,
            timestamp: new Date().toISOString(),
            summary: `[Step ${step}] ${action}: ${detail}`
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : "Action failed";
          detail = errMsg;
          steps.push({ step, action, detail, screenshotTaken: false });

          // Send error back to Claude
          screenshotBase64 = await takeScreenshotBase64(session, width, height);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: [
              { type: "text", text: `Error: ${errMsg}` },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: screenshotBase64
                }
              }
            ],
            is_error: true
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }

    return {
      runId, goal, success: false,
      message: `Reached maximum steps (${maxSteps})`,
      steps, totalSteps: maxSteps,
      totalTokens: { input: totalInput, output: totalOutput }
    };

  } finally {
    // Save episode for learning
    try {
      initEpisodesTable();
      const summary = `Computer Use: ${goal} — ${steps.length} steps`;
      const embedding = await computeEmbedding(summary);
      saveEpisode({
        runId, goal, domain: extractDomain(options.startUrl),
        summary, outcome: steps.length > 0 ? "success" : "failure",
        taskCount: steps.length, replanCount: 0, embedding
      });
    } catch (error) { logModuleError("computer-use-agent", "optional", error, "saving episode for learning after computer use run"); }

    if (!options.keepBrowserAlive) {
      await closeBrowserSession(session);
    }
    closeEmitter(runId);
  }
}

async function executeComputerAction(
  session: BrowserSession,
  input: Record<string, unknown>,
  width: number,
  height: number
): Promise<string> {
  const action = String(input.action);
  const coordinate = input.coordinate as [number, number] | undefined;

  switch (action) {
    case "screenshot":
      return "Captured screenshot";

    case "click":
    case "left_click": {
      if (!coordinate) throw new Error("click requires coordinate");
      await session.page.mouse.click(coordinate[0], coordinate[1]);
      return `Clicked at (${coordinate[0]}, ${coordinate[1]})`;
    }

    case "double_click": {
      if (!coordinate) throw new Error("double_click requires coordinate");
      await session.page.mouse.dblclick(coordinate[0], coordinate[1]);
      return `Double-clicked at (${coordinate[0]}, ${coordinate[1]})`;
    }

    case "right_click": {
      if (!coordinate) throw new Error("right_click requires coordinate");
      await session.page.mouse.click(coordinate[0], coordinate[1], { button: "right" });
      return `Right-clicked at (${coordinate[0]}, ${coordinate[1]})`;
    }

    case "middle_click": {
      if (!coordinate) throw new Error("middle_click requires coordinate");
      await session.page.mouse.click(coordinate[0], coordinate[1], { button: "middle" });
      return `Middle-clicked at (${coordinate[0]}, ${coordinate[1]})`;
    }

    case "mouse_move": {
      if (!coordinate) throw new Error("mouse_move requires coordinate");
      await session.page.mouse.move(coordinate[0], coordinate[1]);
      return `Moved mouse to (${coordinate[0]}, ${coordinate[1]})`;
    }

    case "type": {
      const text = String(input.text ?? "");
      await session.page.keyboard.type(text, { delay: 30 });
      return `Typed: "${text.slice(0, 50)}${text.length > 50 ? "..." : ""}"`;
    }

    case "key": {
      const key = String(input.key ?? "");
      // Map common key names
      const keyMap: Record<string, string> = {
        "Return": "Enter",
        "BackSpace": "Backspace",
        "space": " ",
        "Tab": "Tab",
        "Escape": "Escape"
      };
      await session.page.keyboard.press(keyMap[key] ?? key);
      return `Pressed key: ${key}`;
    }

    case "scroll": {
      const direction = String(input.direction ?? "down");
      const amount = Number(input.amount ?? 3);
      const scrollX = coordinate?.[0] ?? width / 2;
      const scrollY = coordinate?.[1] ?? height / 2;
      const deltaY = direction === "down" ? amount * 100 : direction === "up" ? -amount * 100 : 0;
      const deltaX = direction === "right" ? amount * 100 : direction === "left" ? -amount * 100 : 0;
      await session.page.mouse.move(scrollX, scrollY);
      await session.page.mouse.wheel(deltaX, deltaY);
      return `Scrolled ${direction} at (${scrollX}, ${scrollY})`;
    }

    case "drag": {
      const startCoord = input.start_coordinate as [number, number] | undefined;
      const endCoord = coordinate;
      if (!startCoord || !endCoord) throw new Error("drag requires start_coordinate and coordinate");
      await session.page.mouse.move(startCoord[0], startCoord[1]);
      await session.page.mouse.down();
      await session.page.mouse.move(endCoord[0], endCoord[1]);
      await session.page.mouse.up();
      return `Dragged from (${startCoord[0]}, ${startCoord[1]}) to (${endCoord[0]}, ${endCoord[1]})`;
    }

    case "wait": {
      const ms = Number(input.duration ?? 2000);
      await session.page.waitForTimeout(ms);
      return `Waited ${ms}ms`;
    }

    default:
      throw new Error(`Unknown computer action: ${action}`);
  }
}

async function takeScreenshotBase64(
  session: BrowserSession,
  width: number,
  height: number
): Promise<string> {
  const buffer = await session.page.screenshot({
    type: "png",
    clip: { x: 0, y: 0, width, height }
  });
  return buffer.toString("base64");
}

function extractDomain(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (error) {
    logModuleError("computer-use-agent", "optional", error, "extracting domain from URL");
    return "";
  }
}
