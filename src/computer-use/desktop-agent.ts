/**
 * Desktop Agent — extends Computer Use from browser-only to full desktop control.
 *
 * Uses:
 *   - Screenshot: scrot/import (X11 screen capture)
 *   - Mouse/Keyboard: xdotool (X11 automation)
 *   - App launching: shell commands
 *
 * Requires: Xvfb + xdotool + scrot (installed in Dockerfile.desktop)
 *
 * Architecture:
 *   1. Take screenshot of entire virtual desktop
 *   2. Send to LLM (Claude/K2.5) with the goal
 *   3. LLM returns action (click coordinates, type text, key press, launch app)
 *   4. Execute via xdotool
 *   5. Repeat until goal achieved
 */

import { execFileSync, execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { readProviderConfig, callOpenAICompatible, callAnthropic, safeJsonParse } from "../llm/provider";
import { logModuleError } from "../core/module-logger";

export interface DesktopAgentOptions {
  maxSteps?: number;
  display?: string;
  screenshotDir?: string;
}

export interface DesktopStep {
  step: number;
  thought: string;
  action: string;
  detail: string;
  success: boolean;
}

export interface DesktopResult {
  success: boolean;
  message: string;
  steps: DesktopStep[];
  totalSteps: number;
}

const SYSTEM_PROMPT = `You are a desktop automation agent. You can see a screenshot of a computer desktop and control the mouse and keyboard.

Available actions (respond with JSON):

To click: {"thought": "...", "action": "click", "x": 100, "y": 200}
To double-click: {"thought": "...", "action": "double_click", "x": 100, "y": 200}
To right-click: {"thought": "...", "action": "right_click", "x": 100, "y": 200}
To type text: {"thought": "...", "action": "type", "text": "hello world"}
To press key: {"thought": "...", "action": "key", "key": "Return"}
To press combo: {"thought": "...", "action": "key", "key": "ctrl+s"}
To launch app: {"thought": "...", "action": "launch", "command": "libreoffice --calc"}
To scroll: {"thought": "...", "action": "scroll", "direction": "down", "amount": 3}
When done: {"thought": "explanation", "action": "done"}

RULES:
1. Look at the screenshot carefully before acting
2. Click on visible UI elements — don't guess positions
3. After launching an app, wait for it to load before interacting
4. Use keyboard shortcuts when efficient (ctrl+c, ctrl+v, etc.)
5. READ the screen content first — the answer may already be visible`;

/**
 * Check if desktop automation is available.
 */
export function isDesktopAvailable(): boolean {
  try {
    execFileSync("which", ["xdotool"], { stdio: "pipe" });
    return Boolean(process.env.DISPLAY);
  } catch {
    return false;
  }
}

/**
 * Run a goal on the desktop using vision-driven automation.
 */
export async function runDesktopGoal(
  goal: string,
  options: DesktopAgentOptions = {}
): Promise<DesktopResult> {
  const maxSteps = options.maxSteps ?? 20;
  const display = options.display ?? process.env.DISPLAY ?? ":99";
  const screenshotDir = options.screenshotDir ?? path.join(process.cwd(), "artifacts");

  const config = readProviderConfig("LLM_REACT", { maxTokens: 4000, temperature: 0 });
  if (!config.provider || !config.apiKey) {
    return { success: false, message: "No LLM configured for desktop agent", steps: [], totalSteps: 0 };
  }

  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const steps: DesktopStep[] = [];
  const messages: Array<{ role: "system" | "user"; content: string | Array<{ type: string; [k: string]: unknown }> }> = [
    { role: "system", content: SYSTEM_PROMPT }
  ];

  for (let step = 0; step < maxSteps; step++) {
    const screenshotPath = path.join(screenshotDir, `desktop-step-${step}.png`);
    const screenshotBase64 = takeDesktopScreenshot(display, screenshotPath);
    if (!screenshotBase64) {
      return { success: false, message: "Failed to capture desktop screenshot", steps, totalSteps: step };
    }

    messages.push({
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: screenshotBase64 } },
        { type: "text", text: step === 0
          ? `Goal: ${goal}\n\nThis is the current desktop. What should we do first?`
          : `Step ${step} result: ${steps[step - 1]?.success ? "OK" : "FAILED"} — ${steps[step - 1]?.detail ?? ""}\n\nWhat next?`
        }
      ]
    });

    let responseText: string;
    try {
      if (config.provider === "anthropic") {
        const result = await callAnthropic(config, messages as any, "DesktopAgent");
        responseText = result.content;
      } else {
        const textMessages = messages.map(m => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content :
            (m.content as any[]).map((c: any) => c.type === "image" ? { type: "text", text: "[screenshot]" } : c)
        }));
        const result = await callOpenAICompatible(config, textMessages as any, "DesktopAgent");
        responseText = result.content;
      }
    } catch (error) {
      logModuleError("desktop-agent", "optional", error, "LLM call failed");
      return { success: false, message: "LLM failed to respond", steps, totalSteps: step };
    }

    const parsed = safeJsonParse(responseText) as {
      thought?: string; action?: string;
      x?: number; y?: number; text?: string; key?: string;
      command?: string; direction?: string; amount?: number;
    } | null;

    if (!parsed?.action) {
      return { success: false, message: `Unparseable response: ${responseText.slice(0, 100)}`, steps, totalSteps: step };
    }

    if (parsed.action === "done") {
      return { success: true, message: parsed.thought ?? "Goal achieved", steps, totalSteps: step };
    }

    const result = executeDesktopAction({ ...parsed, action: parsed.action! }, display);
    steps.push({ step, thought: parsed.thought ?? "", action: parsed.action, detail: result, success: !result.startsWith("ERROR") });
    messages.push({ role: "user", content: `Assistant: ${responseText}` });
  }

  return { success: false, message: `Reached maximum steps (${maxSteps})`, steps, totalSteps: maxSteps };
}

function takeDesktopScreenshot(display: string, outputPath: string): string | null {
  const env = { ...process.env, DISPLAY: display };
  const opts = { env, stdio: "pipe" as const, timeout: 5000 };

  try {
    execFileSync("scrot", ["-o", outputPath], opts);
  } catch {
    try {
      execFileSync("import", ["-window", "root", outputPath], opts);
    } catch (error) {
      logModuleError("desktop-agent", "optional", error, "screenshot capture failed");
      return null;
    }
  }

  try {
    return fs.readFileSync(outputPath).toString("base64");
  } catch {
    return null;
  }
}

function executeDesktopAction(
  action: { action: string; x?: number; y?: number; text?: string; key?: string; command?: string; direction?: string; amount?: number },
  display: string
): string {
  const env = { ...process.env, DISPLAY: display };
  const opts = { env, stdio: "pipe" as const, timeout: 10000 };

  try {
    switch (action.action) {
      case "click":
        execFileSync("xdotool", ["mousemove", String(action.x), String(action.y), "click", "1"], opts);
        return `Clicked at (${action.x}, ${action.y})`;

      case "double_click":
        execFileSync("xdotool", ["mousemove", String(action.x), String(action.y), "click", "--repeat", "2", "1"], opts);
        return `Double-clicked at (${action.x}, ${action.y})`;

      case "right_click":
        execFileSync("xdotool", ["mousemove", String(action.x), String(action.y), "click", "3"], opts);
        return `Right-clicked at (${action.x}, ${action.y})`;

      case "type":
        execFileSync("xdotool", ["type", "--delay", "50", action.text ?? ""], opts);
        return `Typed: "${action.text}"`;

      case "key":
        execFileSync("xdotool", ["key", action.key ?? ""], opts);
        return `Pressed: ${action.key}`;

      case "launch": {
        const parts = (action.command ?? "").split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);
        execFile(cmd, args, { env }); // Non-blocking launch
        try { execFileSync("sleep", ["2"], opts); } catch { /* ignore */ }
        return `Launched: ${action.command}`;
      }

      case "scroll": {
        const button = action.direction === "up" ? "4" : "5";
        const amount = String(action.amount ?? 3);
        execFileSync("xdotool", ["click", "--repeat", amount, button], opts);
        return `Scrolled ${action.direction} ${amount} clicks`;
      }

      default:
        return `ERROR: Unknown action: ${action.action}`;
    }
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}
