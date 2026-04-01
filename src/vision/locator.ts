/**
 * Visual Locator
 *
 * Bridges the vision analyzer result with Playwright actions.
 * Given a page and a natural language description, takes a screenshot,
 * asks the vision model to find the element, and returns a Playwright Locator.
 */

import type { Page, Locator } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { visuallyLocateElement, VisualLocateResult } from "./analyzer";

export interface VisualLocatorResult {
  locator: Locator | null;
  raw: VisualLocateResult;
  screenshotPath: string;
}

export async function locateVisually(
  page: Page,
  description: string,
  runId: string
): Promise<VisualLocatorResult> {
  // Take screenshot for vision analysis
  const screenshotDir = join(process.cwd(), "artifacts", "vision");
  await mkdir(screenshotDir, { recursive: true });
  const screenshotPath = join(screenshotDir, `${runId}-locate-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false }); // viewport only for speed

  // Convert to base64
  const screenshotBase64 = readFileSync(screenshotPath).toString("base64");

  // Ask vision model
  const result = await visuallyLocateElement(screenshotBase64, description);

  // Convert result to Playwright Locator
  let locator: Locator | null = null;

  if (result.visible) {
    if (result.selector) {
      locator = page.locator(result.selector);
    } else if (result.playwrightLocator) {
      locator = buildLocatorFromString(page, result.playwrightLocator);
    } else if (result.coordinates) {
      // For coordinate-based clicks, we return null locator and let the handler use coordinates
      locator = null;
    }
  }

  return { locator, raw: result, screenshotPath };
}

function buildLocatorFromString(page: Page, locatorStr: string): Locator {
  // Parse Playwright locator expressions like "text=Login", "role=button name=Submit"
  if (locatorStr.startsWith("text=")) {
    return page.getByText(locatorStr.slice(5).trim(), { exact: false });
  }
  if (locatorStr.startsWith("role=")) {
    const rest = locatorStr.slice(5);
    const nameMatch = rest.match(/^(\w+)\s+name=(.+)$/);
    if (nameMatch) {
      return page.getByRole(nameMatch[1] as never, { name: nameMatch[2].trim() });
    }
    return page.getByRole(rest.trim() as never);
  }
  if (locatorStr.startsWith("label=")) {
    return page.getByLabel(locatorStr.slice(6).trim());
  }
  if (locatorStr.startsWith("placeholder=")) {
    return page.getByPlaceholder(locatorStr.slice(12).trim());
  }
  // Default: treat as CSS selector
  return page.locator(locatorStr);
}

export async function clickVisually(page: Page, description: string, runId: string): Promise<string> {
  const { locator, raw } = await locateVisually(page, description, runId);

  if (!raw.visible || raw.confidence === "low") {
    throw new Error(`Visual locator: element not found — "${description}" (confidence: ${raw.confidence})`);
  }

  if (locator) {
    await locator.click({ timeout: 10000 });
    return `Visually clicked: ${raw.description} (via ${raw.selector ?? raw.playwrightLocator ?? "locator"})`;
  }

  if (raw.coordinates) {
    await page.mouse.click(raw.coordinates.x, raw.coordinates.y);
    return `Visually clicked at (${raw.coordinates.x}, ${raw.coordinates.y}): ${raw.description}`;
  }

  throw new Error(`Visual locator: found element but could not build locator — "${description}"`);
}

export async function typeVisually(
  page: Page,
  description: string,
  text: string,
  runId: string
): Promise<string> {
  const { locator, raw } = await locateVisually(page, description, runId);

  if (!raw.visible || raw.confidence === "low") {
    throw new Error(`Visual locator: input field not found — "${description}" (confidence: ${raw.confidence})`);
  }

  if (locator) {
    await locator.click({ timeout: 10000 });
    await locator.fill(text);
    return `Visually typed "${text}" into: ${raw.description}`;
  }

  if (raw.coordinates) {
    await page.mouse.click(raw.coordinates.x, raw.coordinates.y);
    await page.keyboard.type(text);
    return `Visually typed "${text}" at (${raw.coordinates.x}, ${raw.coordinates.y})`;
  }

  throw new Error(`Visual locator: found input but could not interact — "${description}"`);
}
