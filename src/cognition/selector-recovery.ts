/**
 * Creative Selector Recovery — when a CSS selector fails,
 * searches for the element using alternative strategies:
 * 1. Text-based: find by visible text content
 * 2. Role-based: find by ARIA role or element type
 * 3. Attribute-based: find by data-testid, aria-label, name, placeholder
 * 4. Parent search: find a parent container and locate within it
 */

import type { BrowserSession } from "../browser";

export interface SelectorAlternative {
  selector: string;
  strategy: string;
  confidence: number;
  description: string;
}

/**
 * Try to find an element using alternative strategies when the original selector fails.
 * Returns a list of alternative selectors sorted by confidence.
 */
export async function findAlternativeSelectors(
  session: BrowserSession,
  originalSelector: string,
  taskType: string
): Promise<SelectorAlternative[]> {
  const alternatives: SelectorAlternative[] = [];
  const page = session.page;

  // Extract hints from the original selector
  const textHint = extractTextFromSelector(originalSelector);
  const idHint = extractIdFromSelector(originalSelector);

  // Strategy 1: Text-based search
  if (textHint) {
    try {
      const textSelector = `text="${textHint}"`;
      const count = await page.locator(textSelector).count();
      if (count > 0) {
        alternatives.push({
          selector: textSelector,
          strategy: "text_match",
          confidence: 0.8,
          description: `Found by text content: "${textHint}"`
        });
      }
    } catch { /* continue */ }

    // Also try partial text match
    try {
      const partialSelector = `text=/${escapeRegex(textHint)}/i`;
      const count = await page.locator(partialSelector).count();
      if (count > 0 && !alternatives.some(a => a.strategy === "text_match")) {
        alternatives.push({
          selector: partialSelector,
          strategy: "text_partial",
          confidence: 0.65,
          description: `Found by partial text: "${textHint}"`
        });
      }
    } catch { /* continue */ }
  }

  // Strategy 2: Role-based search
  const roleSelectors = inferRoleSelectors(originalSelector, taskType);
  for (const { selector, role } of roleSelectors) {
    try {
      const count = await page.locator(selector).count();
      if (count > 0 && count <= 5) {
        alternatives.push({
          selector,
          strategy: "role_match",
          confidence: 0.6,
          description: `Found by role: ${role}`
        });
      }
    } catch { /* continue */ }
  }

  // Strategy 3: Attribute-based search
  const attrSelectors = buildAttributeSelectors(originalSelector, textHint);
  for (const { selector, attr } of attrSelectors) {
    try {
      const count = await page.locator(selector).count();
      if (count === 1) {
        alternatives.push({
          selector,
          strategy: "attribute_match",
          confidence: 0.75,
          description: `Found by ${attr}`
        });
      }
    } catch { /* continue */ }
  }

  // Strategy 4: Similar elements nearby
  if (idHint) {
    try {
      const similarSelector = `[id*="${idHint}"], [class*="${idHint}"], [data-testid*="${idHint}"]`;
      const count = await page.locator(similarSelector).count();
      if (count > 0 && count <= 3) {
        alternatives.push({
          selector: similarSelector,
          strategy: "fuzzy_id",
          confidence: 0.55,
          description: `Found similar element with id/class containing "${idHint}"`
        });
      }
    } catch { /* continue */ }
  }

  return alternatives.sort((a, b) => b.confidence - a.confidence);
}

function extractTextFromSelector(selector: string): string | null {
  // Extract from text= selector
  const textMatch = selector.match(/text=["']?([^"']+)["']?/);
  if (textMatch) return textMatch[1];

  // Extract from ID that looks like a readable name
  const idMatch = selector.match(/#([a-zA-Z][\w-]*)/);
  if (idMatch) {
    const id = idMatch[1];
    // Convert camelCase/kebab-case to words
    return id.replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  }

  return null;
}

function extractIdFromSelector(selector: string): string | null {
  const idMatch = selector.match(/#([\w-]+)/);
  if (idMatch) return idMatch[1];

  const classMatch = selector.match(/\.([\w-]+)/);
  if (classMatch) return classMatch[1];

  const testIdMatch = selector.match(/\[data-testid=["']?([^"'\]]+)["']?\]/);
  if (testIdMatch) return testIdMatch[1];

  return null;
}

function inferRoleSelectors(originalSelector: string, taskType: string): Array<{ selector: string; role: string }> {
  const results: Array<{ selector: string; role: string }> = [];

  if (taskType === "click") {
    results.push({ selector: "role=button", role: "button" });
    results.push({ selector: "role=link", role: "link" });
    results.push({ selector: "role=menuitem", role: "menuitem" });
  } else if (taskType === "type") {
    results.push({ selector: "role=textbox", role: "textbox" });
    results.push({ selector: "role=searchbox", role: "searchbox" });
    results.push({ selector: "input:visible", role: "visible input" });
  } else if (taskType === "select") {
    results.push({ selector: "role=combobox", role: "combobox" });
    results.push({ selector: "role=listbox", role: "listbox" });
    results.push({ selector: "select:visible", role: "visible select" });
  }

  return results;
}

function buildAttributeSelectors(
  originalSelector: string,
  textHint: string | null
): Array<{ selector: string; attr: string }> {
  const results: Array<{ selector: string; attr: string }> = [];

  if (textHint) {
    results.push({ selector: `[aria-label="${textHint}"]`, attr: "aria-label" });
    results.push({ selector: `[placeholder="${textHint}"]`, attr: "placeholder" });
    results.push({ selector: `[title="${textHint}"]`, attr: "title" });
    results.push({ selector: `[name="${textHint}"]`, attr: "name" });
    results.push({ selector: `[data-testid="${textHint}"]`, attr: "data-testid" });
  }

  return results;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
