/**
 * Vision Handler
 *
 * Executes visual_click, visual_type, visual_assert, visual_extract actions.
 * These actions use natural language descriptions instead of CSS selectors,
 * delegating element finding to the vision LLM.
 */

import type { TaskExecutionOutput } from "./browser-handler";
import { clickVisually, typeVisually, locateVisually } from "../vision/locator";
import { visuallyAssert } from "../vision/analyzer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { AgentTask, RunContext } from "../types";
import { Logger } from "../logger";

export async function handleVisionTask(
  context: RunContext,
  task: AgentTask,
  logger = new Logger()
): Promise<TaskExecutionOutput> {
  const page = context.browserSession?.page;
  if (!page) throw new Error("No browser session — open a page first");

  const runId = context.runId;

  switch (task.type) {
    case "visual_click": {
      const description = String(task.payload["description"] ?? "");
      if (!description) throw new Error("visual_click requires payload.description");
      logger.info(`Visually clicking: "${description}"`);
      const summary = await clickVisually(page, description, runId);
      return { summary };
    }

    case "visual_type": {
      const description = String(task.payload["description"] ?? "");
      const text = String(task.payload["text"] ?? "");
      if (!description) throw new Error("visual_type requires payload.description");
      if (!text) throw new Error("visual_type requires payload.text");
      logger.info(`Visually typing "${text}" into: "${description}"`);
      const summary = await typeVisually(page, description, text, runId);
      return { summary };
    }

    case "visual_assert": {
      const assertion = String(task.payload["assertion"] ?? "");
      if (!assertion) throw new Error("visual_assert requires payload.assertion");
      logger.info(`Visual assertion: "${assertion}"`);

      const screenshotDir = join(process.cwd(), "artifacts", "vision");
      await mkdir(screenshotDir, { recursive: true });
      const screenshotPath = join(screenshotDir, `${runId}-assert-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      const screenshotBase64 = readFileSync(screenshotPath).toString("base64");

      const result = await visuallyAssert(screenshotBase64, assertion);
      if (!result.passed) {
        throw new Error(`Visual assertion failed: "${assertion}" — found: "${result.found}" (confidence: ${result.confidence})`);
      }
      return {
        summary: `Visual assertion passed: "${assertion}" — ${result.found}`,
        artifacts: [{ type: "screenshot", path: screenshotPath, description: `Visual assertion: ${assertion}` }]
      };
    }

    case "visual_extract": {
      const description = String(task.payload["description"] ?? "");
      if (!description) throw new Error("visual_extract requires payload.description");
      logger.info(`Visually extracting: "${description}"`);

      const { raw, screenshotPath } = await locateVisually(page, description, runId);
      const extracted = raw.description;
      return {
        summary: `Extracted: "${extracted}"`,
        artifacts: [{ type: "screenshot", path: screenshotPath, description: `Visual extract: ${description}` }]
      };
    }

    default:
      throw new Error(`Unknown vision task type: ${task.type}`);
  }
}
