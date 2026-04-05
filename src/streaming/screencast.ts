/**
 * CDP Screencast — streams live browser frames via SSE at ~10fps.
 *
 * Playwright exposes the Chrome DevTools Protocol (CDP) via page.context().browser().
 * We use the Page.startScreencast / Page.screencastFrame CDP events to receive
 * JPEG frames and push them to the run's EventBus in real-time.
 *
 * This replaces the "one screenshot per action" model with continuous video-like
 * streaming while the agent is working.
 */

import type { Page } from "playwright";
import { publishEvent } from "./event-bus";
import { logModuleError } from "../core/module-logger";

interface ScreencastSession {
  stop: () => Promise<void>;
}

/**
 * Start streaming browser frames for a given runId.
 * Returns a stop() function to clean up.
 */
export async function startScreencast(
  page: Page,
  runId: string,
  fps = 10
): Promise<ScreencastSession> {
  // Access CDP session via Playwright's internal CDPSession API
  const cdp = await page.context().newCDPSession(page);

  let active = true;

  // Handle incoming frames
  cdp.on("Page.screencastFrame", (event: { data: string; sessionId: number }) => {
    if (!active) return;

    publishEvent({
      type: "screenshot",
      runId,
      timestamp: new Date().toISOString(),
      screenshotDataUrl: `data:image/jpeg;base64,${event.data}`
    });

    // Acknowledge frame to keep CDP sending
    cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
  });

  // Start screencast
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 60,
    maxWidth: 1280,
    maxHeight: 800,
    everyNthFrame: Math.max(1, Math.round(60 / fps))
  });

  return {
    async stop() {
      active = false;
      try {
        await cdp.send("Page.stopScreencast");
        await cdp.detach();
      } catch (error) { logModuleError("screencast", "optional", error, "stopping screencast and detaching CDP session"); }
    }
  };
}
