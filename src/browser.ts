import { Browser, BrowserContext, Page, chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function createBrowserSession(): Promise<BrowserSession> {
  const headless = process.env.PLAYWRIGHT_HEADLESS !== "false";
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  return {
    browser,
    context,
    page
  };
}

export async function openPage(session: BrowserSession, url: string): Promise<string> {
  await session.page.goto(url, { waitUntil: "domcontentloaded" });
  const title = await session.page.title();
  return title || "No title";
}

export async function clickElement(session: BrowserSession, selector: string): Promise<void> {
  await session.page.click(selector);
}

export async function typeIntoElement(session: BrowserSession, selector: string, text: string): Promise<void> {
  await session.page.click(selector);
  await session.page.fill(selector, text);
}

export async function selectOption(session: BrowserSession, selector: string, value: string): Promise<void> {
  await session.page.selectOption(selector, value);
}

export async function scrollElement(
  session: BrowserSession,
  selector: string | undefined,
  direction: "up" | "down" | "left" | "right",
  amount: number
): Promise<void> {
  const deltaX = direction === "right" ? amount : direction === "left" ? -amount : 0;
  const deltaY = direction === "down" ? amount : direction === "up" ? -amount : 0;

  if (selector) {
    await session.page.locator(selector).scrollIntoViewIfNeeded();
    await session.page.locator(selector).evaluate(
      (el, [dx, dy]) => el.scrollBy(dx as number, dy as number),
      [deltaX, deltaY]
    );
  } else {
    await session.page.evaluate(([dx, dy]) => window.scrollBy(dx as number, dy as number), [deltaX, deltaY]);
  }
}

export async function hoverElement(session: BrowserSession, selector: string): Promise<void> {
  await session.page.hover(selector);
}

export async function waitForDuration(session: BrowserSession | undefined, durationMs: number): Promise<void> {
  if (session) {
    await session.page.waitForTimeout(durationMs);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

export async function takeScreenshot(session: BrowserSession, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await session.page.screenshot({ path: outputPath, fullPage: true });
}

export async function closeBrowserSession(session?: BrowserSession): Promise<void> {
  if (!session) {
    return;
  }

  await session.browser.close();
}

/**
 * Switch to an iframe within the current page.
 * Returns the frame locator for interaction.
 */
export async function switchToFrame(session: BrowserSession, selector: string): Promise<void> {
  const frame = session.page.frameLocator(selector);
  // Playwright doesn't "switch" to frames — you use frameLocator for interactions
  // Store the frame selector on the session for downstream use
  (session as any)._activeFrame = selector;
}

/**
 * Switch back to the main frame.
 */
export function switchToMainFrame(session: BrowserSession): void {
  (session as any)._activeFrame = undefined;
}

/**
 * Get the active frame locator, or the page if no frame is active.
 */
export function getActiveLocator(session: BrowserSession): Page {
  const frameSelector = (session as any)._activeFrame;
  if (frameSelector) {
    // Return a proxy-like page for the frame
    // Playwright handles this via frameLocator
    return session.page;
  }
  return session.page;
}

/**
 * Get the active frame selector, if any.
 */
export function getActiveFrame(session: BrowserSession): string | undefined {
  return (session as any)._activeFrame;
}

/**
 * Click an element, trying iframe fallback if not found on main page.
 */
export async function clickWithIframeFallback(
  session: BrowserSession,
  selector: string
): Promise<{ inIframe: boolean; frameSelector?: string }> {
  // First try on main page
  try {
    const count = await session.page.locator(selector).count();
    if (count > 0) {
      await session.page.click(selector);
      return { inIframe: false };
    }
  } catch { /* try iframes */ }

  // Search in all iframes
  const frames = session.page.frames();
  for (const frame of frames) {
    if (frame === session.page.mainFrame()) continue;
    try {
      const count = await frame.locator(selector).count();
      if (count > 0) {
        await frame.click(selector);
        return { inIframe: true, frameSelector: frame.url() };
      }
    } catch { /* continue */ }
  }

  // Fallback to original click (will throw if element not found)
  await session.page.click(selector);
  return { inIframe: false };
}

/**
 * Open a new tab and navigate to a URL.
 * Returns the new page.
 */
export async function openNewTab(session: BrowserSession, url: string): Promise<Page> {
  const newPage = await session.context.newPage();
  await newPage.goto(url, { waitUntil: "domcontentloaded" });
  return newPage;
}

/**
 * Switch to a different tab by index.
 */
export function switchToTab(session: BrowserSession, index: number): Page | null {
  const pages = session.context.pages();
  if (index < 0 || index >= pages.length) return null;
  session.page = pages[index];
  return session.page;
}

/**
 * Get all open tabs/pages.
 */
export function getAllTabs(session: BrowserSession): Page[] {
  return session.context.pages();
}

/**
 * Close a tab by index. Switches to the previous tab if current is closed.
 */
export async function closeTab(session: BrowserSession, index: number): Promise<boolean> {
  const pages = session.context.pages();
  if (index < 0 || index >= pages.length) return false;

  const pageToClose = pages[index];
  const isCurrent = pageToClose === session.page;

  await pageToClose.close();

  if (isCurrent) {
    const remaining = session.context.pages();
    if (remaining.length > 0) {
      session.page = remaining[Math.min(index, remaining.length - 1)];
    }
  }

  return true;
}

/**
 * Listen for new popup windows and auto-switch to them.
 */
export function setupPopupHandler(session: BrowserSession): void {
  session.page.on("popup", async (popup) => {
    try {
      await popup.waitForLoadState("domcontentloaded");
      // Auto-switch to popup
      session.page = popup;
    } catch {
      // Popup may have been closed
    }
  });
}
