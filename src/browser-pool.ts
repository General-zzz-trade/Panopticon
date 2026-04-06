/**
 * Browser Pool — pre-warm Chromium instances for faster session acquisition.
 *
 * Maintains a pool of pre-launched Playwright browser contexts so that
 * runGoal() doesn't pay the cold-start cost on every run.
 */

import { Browser, BrowserContext, Page, chromium } from "playwright";
import { createBrowserSession, BrowserSession } from "./browser";
import { logModuleError } from "./core/module-logger";

export interface PooledSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

interface PoolEntry {
  session: PooledSession;
  inUse: boolean;
}

const pool: PoolEntry[] = [];
let initialized = false;

/**
 * Launch `size` headless Chromium browsers and store them in the pool.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function initPool(size: number = 2): Promise<void> {
  if (initialized) return;
  initialized = true;

  const launches: Promise<void>[] = [];
  for (let i = 0; i < size; i++) {
    launches.push(
      (async () => {
        try {
          const session = await createBrowserSession();
          pool.push({
            session: {
              browser: session.browser,
              context: session.context,
              page: session.page,
            },
            inUse: false,
          });
        } catch (error) {
          logModuleError("browser-pool", "critical", error, "pre-warming browser instance");
        }
      })()
    );
  }

  await Promise.all(launches);
}

/**
 * Acquire a warm browser context from the pool.
 * If no idle sessions are available, creates a new one on the fly.
 */
export async function acquireSession(): Promise<PooledSession> {
  // Look for an idle entry
  const idle = pool.find((e) => !e.inUse);
  if (idle) {
    idle.inUse = true;
    return idle.session;
  }

  // Pool exhausted — create a fresh session and track it
  try {
    const session = await createBrowserSession();
    const pooled: PooledSession = {
      browser: session.browser,
      context: session.context,
      page: session.page,
    };
    pool.push({ session: pooled, inUse: true });
    return pooled;
  } catch (error) {
    logModuleError("browser-pool", "critical", error, "creating overflow browser session");
    throw error;
  }
}

/**
 * Return a session to the pool for reuse.
 * Clears cookies and local storage so the next consumer gets a clean slate.
 */
export async function releaseSession(session: PooledSession): Promise<void> {
  const entry = pool.find((e) => e.session === session);
  if (!entry) return;

  try {
    // Clear cookies
    await session.context.clearCookies();

    // Clear local/session storage on every page
    for (const page of session.context.pages()) {
      try {
        await page.evaluate(() => {
          try { localStorage.clear(); } catch {}
          try { sessionStorage.clear(); } catch {}
        });
      } catch {
        // Page may have been closed or navigated to about:blank — ignore
      }
    }

    // Close extra pages, keep only one
    const pages = session.context.pages();
    for (let i = 1; i < pages.length; i++) {
      try { await pages[i].close(); } catch {}
    }

    // Navigate the remaining page to about:blank for a clean slate
    if (pages.length > 0) {
      try {
        await pages[0].goto("about:blank");
        session.page = pages[0];
      } catch {}
    } else {
      // All pages were closed — open a fresh one
      session.page = await session.context.newPage();
    }

    entry.inUse = false;
  } catch (error) {
    logModuleError("browser-pool", "optional", error, "cleaning session before release");
    // Session is dirty — remove from pool and close
    const idx = pool.indexOf(entry);
    if (idx !== -1) pool.splice(idx, 1);
    try { await session.browser.close(); } catch {}
  }
}

/**
 * Pool statistics.
 */
export function getPoolStats(): { available: number; inUse: number; total: number } {
  const inUse = pool.filter((e) => e.inUse).length;
  return {
    available: pool.length - inUse,
    inUse,
    total: pool.length,
  };
}

/**
 * Gracefully close every browser in the pool.
 */
export async function shutdownPool(): Promise<void> {
  const closing = pool.map(async (entry) => {
    try {
      await entry.session.browser.close();
    } catch (error) {
      logModuleError("browser-pool", "optional", error, "closing browser during shutdown");
    }
  });

  await Promise.all(closing);
  pool.length = 0;
  initialized = false;
}
