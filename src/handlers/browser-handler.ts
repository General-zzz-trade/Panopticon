import { Logger } from "../logger";
import { logModuleError } from "../core/module-logger";
import {
  clickElement,
  clickWithIframeFallback,
  createBrowserSession,
  hoverElement,
  openPage,
  scrollElement,
  selectOption,
  setupPopupHandler,
  takeScreenshot,
  typeIntoElement,
  waitForDuration
} from "../browser";
import { AgentTask, RunArtifact, RunContext } from "../types";
import { publishEvent } from "../streaming/event-bus";
import { startScreencast } from "../streaming/screencast";
import { restoreSession, captureSession, extractDomain, isPasswordSelector } from "../auth/session-manager";
import { isVisualFallbackAvailable, handleVisualBrowserTask } from "./computer-use-handler";

export interface TaskExecutionOutput {
  summary: string;
  artifacts?: RunArtifact[];
  stateHints?: string[];
  observationHints?: string[];
}

async function captureAndPublishScreenshot(context: RunContext, taskId: string): Promise<void> {
  if (!context.browserSession?.page) return;
  try {
    const buffer = await context.browserSession.page.screenshot({ type: "jpeg", quality: 60 });
    const dataUrl = `data:image/jpeg;base64,${buffer.toString("base64")}`;
    publishEvent({
      type: "screenshot",
      runId: context.runId,
      taskId,
      timestamp: new Date().toISOString(),
      screenshotDataUrl: dataUrl
    });
  } catch (error) {
    logModuleError("browser-handler", "optional", error, "screenshot capture failed");
  }
}

export async function handleBrowserTask(
  context: RunContext,
  task: AgentTask,
  logger: Logger
): Promise<TaskExecutionOutput> {
  const result = await executeBrowserAction(context, task, logger);
  await captureAndPublishScreenshot(context, task.id);
  return result;
}

async function executeBrowserAction(
  context: RunContext,
  task: AgentTask,
  logger: Logger
): Promise<TaskExecutionOutput> {
  switch (task.type) {
    case "open_page": {
      const url = readString(task, "url");
      const domain = extractDomain(url);
      const tenantId = context.tenantId ?? "default";
      const isFirstPage = !context.browserSession;
      const session = await getOrCreateBrowserSession(context);

      // Restore saved session cookies before navigating
      const restored = await restoreSession(session.context, tenantId, domain);
      if (restored) {
        logger.info(`Restored saved session for ${domain}`);
      }

      logger.info(`Opening page: ${url}`);
      const title = await openPage(session, url);
      // Wait for SPA hydration / network settle
      try {
        await session.page.waitForLoadState("networkidle", { timeout: 5000 });
      } catch (error) {
        logModuleError("browser-handler", "optional", error, "network idle timeout during page load");
      }

      // Capture any cookies set during navigation (e.g., CSRF tokens)
      await captureSession(session.context, tenantId, domain);

      // Start continuous screencast on first page open (replaces per-action screenshots)
      if (isFirstPage && session.page && !context.screencastSession) {
        context.screencastSession = await startScreencast(session.page, context.runId).catch(() => undefined);
      }
      return {
        summary: `Opened page: ${url} (${title})${restored ? " [session restored]" : ""}`,
        stateHints: [`opened_url:${url}`, `page_title:${title}`],
        observationHints: restored ? ["session_restored:true"] : undefined
      };
    }

    case "click": {
      const selector = readString(task, "selector");
      const session = requireBrowserSession(context, task.type);
      logger.info(`Clicking: ${selector}`);
      // Wait for element to appear (handles dynamic content and SPA navigation)
      let selectorFound = true;
      try {
        await session.page.waitForSelector(selector, { timeout: 5000 });
      } catch (error) {
        logModuleError("browser-handler", "optional", error, "waitForSelector before click");
        selectorFound = false;
      }
      // If selector not found and visual fallback available, try visual mode
      if (!selectorFound && isVisualFallbackAvailable()) {
        logger.info(`Selector "${selector}" not found, attempting visual fallback`);
        try {
          const visualResult = await handleVisualBrowserTask(context, task, logger);
          if (visualResult.stateHints?.includes("visual_fallback_used")) {
            return { ...visualResult, stateHints: [...(visualResult.stateHints ?? []), `original_selector:${selector}`] };
          }
        } catch (error) {
          logModuleError("browser-handler", "optional", error, "visual fallback for click");
        }
        // Visual fallback failed — throw immediately instead of waiting 30s for selector again
        if (!selectorFound) {
          throw new Error(`Selector "${selector}" not found and visual fallback unavailable`);
        }
      }
      // Try clicking with iframe fallback
      const clickResult = await clickWithIframeFallback(session, selector);
      if (clickResult.inIframe) {
        logger.info(`Found element in iframe: ${clickResult.frameSelector}`);
      }

      // Capture session after clicking login/submit buttons (heuristic)
      const lowerSelector = selector.toLowerCase();
      if (lowerSelector.includes("login") || lowerSelector.includes("sign") || lowerSelector.includes("submit")) {
        const tenantId = context.tenantId ?? "default";
        const currentUrl = session.page.url();
        const domain = extractDomain(currentUrl);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await captureSession(session.context, tenantId, domain);
        logger.info(`Captured session for ${domain} after login click`);
      }

      return {
        summary: `Clicked: ${selector}`,
        stateHints: [`clicked_selector:${selector}`]
      };
    }

    case "type": {
      const selector = readString(task, "selector");
      const text = readString(task, "text");
      const session = requireBrowserSession(context, task.type);
      logger.info(`Typing into: ${selector}`);
      let typeSelectorFound = true;
      try {
        await session.page.waitForSelector(selector, { timeout: 5000 });
      } catch (error) {
        logModuleError("browser-handler", "optional", error, "waitForSelector before type");
        typeSelectorFound = false;
      }
      if (!typeSelectorFound && isVisualFallbackAvailable()) {
        logger.info(`Selector "${selector}" not found for type, attempting visual fallback`);
        try {
          const visualResult = await handleVisualBrowserTask(context, task, logger);
          if (visualResult.stateHints?.includes("visual_fallback_used")) {
            return { ...visualResult, stateHints: [...(visualResult.stateHints ?? []), `original_selector:${selector}`] };
          }
        } catch (error) {
          logModuleError("browser-handler", "optional", error, "visual fallback for type");
        }
        if (!typeSelectorFound) {
          throw new Error(`Selector "${selector}" not found for type and visual fallback unavailable`);
        }
      }
      await typeIntoElement(session, selector, text);

      // Auto-capture session after typing into a password field (login heuristic)
      if (isPasswordSelector(selector)) {
        const tenantId = context.tenantId ?? "default";
        const currentUrl = session.page.url();
        const domain = extractDomain(currentUrl);
        logger.info(`Password field detected — will capture session for ${domain}`);
        setTimeout(async () => {
          try {
            await captureSession(session.context, tenantId, domain);
          } catch (error) { logModuleError("browser-handler", "optional", error, "session capture after password input"); }
        }, 2000);
      }

      return {
        summary: `Typed into: ${selector}`,
        stateHints: [`typed_selector:${selector}`]
      };
    }

    case "select": {
      const selector = readString(task, "selector");
      const value = readString(task, "value");
      const session = requireBrowserSession(context, task.type);
      logger.info(`Selecting "${value}" in: ${selector}`);
      try {
        await session.page.waitForSelector(selector, { timeout: 5000 });
      } catch (error) {
        logModuleError("browser-handler", "optional", error, "waitForSelector before select");
      }
      await selectOption(session, selector, value);
      return {
        summary: `Selected "${value}" in: ${selector}`,
        stateHints: [`selected_value:${value}`, `selected_selector:${selector}`]
      };
    }

    case "scroll": {
      const selector = task.payload.selector ? readString(task, "selector") : undefined;
      const direction = (readString(task, "direction", "down") as "up" | "down" | "left" | "right");
      const amount = readNumber(task, "amount", 300);
      const session = requireBrowserSession(context, task.type);
      logger.info(`Scrolling ${direction} ${amount}px${selector ? ` on: ${selector}` : ""}`);
      await scrollElement(session, selector, direction, amount);
      return {
        summary: `Scrolled ${direction} ${amount}px`,
        stateHints: [`scroll_direction:${direction}`, `scroll_amount:${amount}`]
      };
    }

    case "hover": {
      const selector = readString(task, "selector");
      const session = requireBrowserSession(context, task.type);
      logger.info(`Hovering: ${selector}`);
      await hoverElement(session, selector);
      return {
        summary: `Hovered: ${selector}`,
        stateHints: [`hovered_selector:${selector}`]
      };
    }

    case "wait": {
      const durationMs = readNumber(task, "durationMs", 1000);
      logger.info(`Waiting: ${durationMs}ms`);
      await waitForDuration(context.browserSession, durationMs);
      return {
        summary: `Waited: ${durationMs}ms`,
        stateHints: [`waited_ms:${durationMs}`]
      };
    }

    case "screenshot": {
      const outputPath = readString(task, "outputPath", "artifacts/screenshot.png");
      const session = requireBrowserSession(context, task.type);
      logger.info(`Saving screenshot: ${outputPath}`);
      await takeScreenshot(session, outputPath);
      return {
        summary: `Screenshot: ${outputPath}`,
        stateHints: [`screenshot_path:${outputPath}`],
        artifacts: [
          {
            type: "screenshot",
            path: outputPath,
            description: `Screenshot captured for ${task.id}`
          }
        ]
      };
    }

    default:
      throw new Error(`Unsupported browser task: ${task.type}`);
  }
}

async function getOrCreateBrowserSession(context: RunContext) {
  if (!context.browserSession) {
    context.browserSession = await createBrowserSession();
    // Auto-dismiss dialogs (alert, confirm, prompt) to prevent blocking
    context.browserSession.page.on("dialog", async (dialog) => {
      try {
        await dialog.accept();
      } catch (error) {
        logModuleError("browser-handler", "optional", error, "dialog auto-dismiss");
      }
    });
    // Auto-switch to popup windows
    setupPopupHandler(context.browserSession);
  }

  return context.browserSession;
}

function requireBrowserSession(context: RunContext, taskType: AgentTask["type"]) {
  if (!context.browserSession) {
    throw new Error(`${taskType} requires an open browser page. Add an open_page task first.`);
  }

  return context.browserSession;
}

function readString(task: AgentTask, key: string, fallback?: string): string {
  const value = task.payload[key];
  if (typeof value === "string") {
    return value;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(`${task.type} task requires payload.${key}.`);
}

function readNumber(task: AgentTask, key: string, fallback?: number): number {
  const value = task.payload[key];
  if (typeof value === "number") {
    return value;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(`${task.type} task requires payload.${key}.`);
}
