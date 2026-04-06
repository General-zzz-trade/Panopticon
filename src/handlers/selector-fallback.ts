/**
 * Selector Fallback Chain — resilient element interaction for Playwright.
 *
 * When a CSS selector fails, tries a sequence of fallback strategies:
 *   1. Original CSS selector
 *   2. data-testid variant
 *   3. aria-label variant
 *   4. Playwright text selector
 *   5. XPath fallback
 */

import { Page } from "playwright";
import { logModuleError } from "../core/module-logger";

const DEFAULT_TIMEOUT = 3000;

/**
 * Derive fallback selectors from the original CSS selector.
 */
function buildFallbackChain(selector: string): string[] {
  const chain: string[] = [selector];

  // Extract a meaningful identifier from the selector.
  // Strip leading # or . and any attribute-selector brackets.
  const cleaned = selector
    .replace(/^[#.]/, "")
    .replace(/\[.*\]/, "")
    .replace(/[>~+\s].*/g, "")
    .trim();

  if (cleaned) {
    chain.push(`[data-testid="${cleaned}"]`);
    chain.push(`[aria-label="${cleaned}"]`);
    chain.push(`text=${cleaned}`);
    chain.push(`xpath=//*[contains(@id,"${cleaned}") or contains(@class,"${cleaned}") or contains(text(),"${cleaned}")]`);
  }

  return chain;
}

/**
 * Try each selector in the fallback chain until one succeeds.
 * Returns the index of the selector that worked, or -1 on total failure.
 */
async function tryChain(
  page: Page,
  selectors: string[],
  action: (sel: string) => Promise<void>,
  timeout: number
): Promise<number> {
  for (let i = 0; i < selectors.length; i++) {
    try {
      const sel = selectors[i];
      // Wait briefly for element to appear, then act
      await page.waitForSelector(sel, { timeout, state: "attached" });
      await action(sel);
      if (i > 0) {
        logModuleError(
          "selector-fallback",
          "optional",
          `Original selector failed; fallback #${i + 1} succeeded: ${sel}`,
          `original: ${selectors[0]}`
        );
      }
      return i;
    } catch {
      // Continue to next fallback
    }
  }
  return -1;
}

/**
 * Click an element using the fallback chain.
 * Returns true if any selector worked.
 */
export async function resilientClick(
  page: Page,
  selector: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<boolean> {
  const chain = buildFallbackChain(selector);
  const idx = await tryChain(
    page,
    chain,
    (sel) => page.click(sel, { timeout }),
    timeout
  );
  return idx !== -1;
}

/**
 * Type into an element using the fallback chain.
 * Returns true if any selector worked.
 */
export async function resilientType(
  page: Page,
  selector: string,
  text: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<boolean> {
  const chain = buildFallbackChain(selector);
  const idx = await tryChain(
    page,
    chain,
    async (sel) => {
      await page.click(sel, { timeout });
      await page.fill(sel, text);
    },
    timeout
  );
  return idx !== -1;
}

/**
 * Wait for an element to appear using the fallback chain.
 * Returns true if any selector was found.
 */
export async function resilientWait(
  page: Page,
  selector: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<boolean> {
  const chain = buildFallbackChain(selector);
  const idx = await tryChain(
    page,
    chain,
    async (sel) => {
      await page.waitForSelector(sel, { timeout, state: "visible" });
    },
    timeout
  );
  return idx !== -1;
}
