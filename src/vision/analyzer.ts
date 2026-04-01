/**
 * Visual Perception Analyzer
 *
 * Takes a base64 screenshot + natural language description of what to find,
 * returns a CSS selector or coordinates for Playwright to act on.
 *
 * Uses any OpenAI-compatible vision API (Claude, GPT-4o, etc.)
 * Configured via env: LLM_VISION_API_KEY, LLM_VISION_BASE_URL, LLM_VISION_MODEL
 */

import { readProviderConfig } from "../llm/provider";

export interface VisualLocateResult {
  /** CSS selector if the element can be identified precisely */
  selector?: string;
  /** Pixel coordinates if no reliable selector found */
  coordinates?: { x: number; y: number };
  /** Playwright getBy* strategy if applicable */
  playwrightLocator?: string;
  /** How confident the vision model is */
  confidence: "high" | "medium" | "low";
  /** Human-readable description of what was found */
  description: string;
  /** Whether the element appears visible and interactable */
  visible: boolean;
}

export interface VisualAssertResult {
  /** Whether the assertion passed */
  passed: boolean;
  /** What was found on screen */
  found: string;
  /** Confidence in the result */
  confidence: "high" | "medium" | "low";
}

const LOCATE_SYSTEM_PROMPT = `You are a UI element locator. Given a screenshot and a description of an element to find, you identify the best way to locate it for browser automation.

Respond with JSON only:
{
  "selector": "CSS selector if you can see a reliable id/class (e.g. #submit-btn, .nav-login)",
  "playwrightLocator": "Playwright locator if selector not available (e.g. text=Login, role=button name=Submit)",
  "coordinates": {"x": 123, "y": 456},
  "confidence": "high|medium|low",
  "description": "what you found",
  "visible": true
}

Rules:
- Prefer selector with #id if visible in screenshot
- Fall back to playwrightLocator (text= or role=) if no id
- Fall back to coordinates as last resort
- If element not found, return {"confidence":"low","description":"element not found","visible":false}`;

const ASSERT_SYSTEM_PROMPT = `You are a UI assertion checker. Given a screenshot and an assertion description, determine if the assertion passes.

Respond with JSON only:
{
  "passed": true,
  "found": "what you actually see on screen relevant to the assertion",
  "confidence": "high|medium|low"
}`;

export async function visuallyLocateElement(
  screenshotBase64: string,
  description: string
): Promise<VisualLocateResult> {
  const config = readProviderConfig("LLM_VISION", { model: "gpt-4o-mini", maxTokens: 300 });

  if (!config.apiKey || !config.baseUrl) {
    return {
      confidence: "low",
      description: "Vision LLM not configured (set LLM_VISION_API_KEY and LLM_VISION_BASE_URL)",
      visible: false
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: LOCATE_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${screenshotBase64}`, detail: "high" }
              },
              {
                type: "text",
                text: `Find this element: "${description}"`
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) throw new Error(`Vision API HTTP ${response.status}`);

    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as VisualLocateResult;
    return { visible: true, confidence: "medium", description: "element found", ...parsed };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { confidence: "low", description: `Vision LLM timed out after ${config.timeoutMs}ms`, visible: false };
    }
    return { confidence: "low", description: `Vision LLM error: ${error instanceof Error ? error.message : "unknown"}`, visible: false };
  } finally {
    clearTimeout(timeout);
  }
}

export async function visuallyAssert(
  screenshotBase64: string,
  assertion: string
): Promise<VisualAssertResult> {
  const config = readProviderConfig("LLM_VISION", { model: "gpt-4o-mini", maxTokens: 200 });

  if (!config.apiKey || !config.baseUrl) {
    return { passed: false, found: "Vision LLM not configured", confidence: "low" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: ASSERT_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${screenshotBase64}`, detail: "high" }
              },
              {
                type: "text",
                text: `Assert: "${assertion}"`
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) throw new Error(`Vision API HTTP ${response.status}`);
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content ?? "{}";
    return JSON.parse(content) as VisualAssertResult;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { passed: false, found: `Vision LLM timed out`, confidence: "low" };
    }
    return { passed: false, found: `Vision error: ${error instanceof Error ? error.message : "unknown"}`, confidence: "low" };
  } finally {
    clearTimeout(timeout);
  }
}
