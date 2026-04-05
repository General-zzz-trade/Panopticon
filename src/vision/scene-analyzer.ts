/**
 * Scene Analyzer — VLM-based whole-page understanding.
 * Unlike the element locator (finds ONE element), this describes
 * the entire visible page: layout, key elements, state indicators.
 */

import { logModuleError } from "../core/module-logger";
import { readProviderConfig, callAnthropic, callOpenAICompatible } from "../llm/provider";

export interface SceneDescription {
  pageType: "login" | "dashboard" | "form" | "list" | "error" | "loading" | "unknown";
  layout: string;
  keyElements: Array<{
    type: string;
    label: string;
    state?: "enabled" | "disabled" | "focused" | "selected" | "hidden";
  }>;
  stateIndicators: string[];
  confidence: number;
}

/**
 * Analyze a screenshot and return a structured scene description.
 * Falls back to a heuristic-based description if no VLM is configured.
 */
export async function analyzeScene(
  screenshotBase64: string
): Promise<SceneDescription> {
  const config = readProviderConfig("LLM_VISION", { maxTokens: 500, temperature: 0 });

  if (config.provider && config.apiKey) {
    try {
      return await analyzeWithVLM(config, screenshotBase64);
    } catch (error) {
      logModuleError("scene-analyzer", "optional", error, "VLM scene analysis");
    }
  }

  return createEmptyScene();
}

async function analyzeWithVLM(
  config: ReturnType<typeof readProviderConfig>,
  screenshotBase64: string
): Promise<SceneDescription> {
  const prompt = `Analyze this webpage screenshot and respond with JSON only:
{
  "pageType": "login"|"dashboard"|"form"|"list"|"error"|"loading"|"unknown",
  "layout": "brief layout description",
  "keyElements": [{"type": "button|input|link|text|image", "label": "visible text or description", "state": "enabled|disabled|focused"}],
  "stateIndicators": ["list of visual state clues like 'loading spinner visible', 'error banner shown'"],
  "confidence": 0.0-1.0
}`;

  const messages = [
    { role: "system" as const, content: prompt },
    { role: "user" as const, content: `[Screenshot attached as base64, ${screenshotBase64.length} chars. Analyze the page.]` }
  ];

  const { content } = config.provider === "anthropic"
    ? await callAnthropic(config, messages, "SceneAnalyzer")
    : await callOpenAICompatible(config, messages, "SceneAnalyzer");

  try {
    const parsed = JSON.parse(content) as SceneDescription;
    return {
      pageType: parsed.pageType ?? "unknown",
      layout: parsed.layout ?? "",
      keyElements: Array.isArray(parsed.keyElements) ? parsed.keyElements : [],
      stateIndicators: Array.isArray(parsed.stateIndicators) ? parsed.stateIndicators : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5
    };
  } catch (error) {
    logModuleError("scene-analyzer", "optional", error, "VLM response JSON parsing");
    return createEmptyScene();
  }
}

function createEmptyScene(): SceneDescription {
  return {
    pageType: "unknown",
    layout: "",
    keyElements: [],
    stateIndicators: [],
    confidence: 0
  };
}

/**
 * Analyze a scene using only DOM text (no VLM needed).
 * Used as a lightweight fallback when no screenshot is available.
 */
export function analyzeSceneFromText(visibleText: string[]): SceneDescription {
  const text = visibleText.join(" ").toLowerCase();

  let pageType: SceneDescription["pageType"] = "unknown";
  if (/login|sign in|log in/i.test(text)) pageType = "login";
  else if (/dashboard|welcome|home/i.test(text)) pageType = "dashboard";
  else if (/error|failed|exception/i.test(text)) pageType = "error";
  else if (/loading|please wait|spinner/i.test(text)) pageType = "loading";
  else if (/submit|form|input/i.test(text)) pageType = "form";

  const stateIndicators: string[] = [];
  if (/loading|spinner/i.test(text)) stateIndicators.push("loading indicator detected");
  if (/error|failed/i.test(text)) stateIndicators.push("error message detected");
  if (/success|saved|updated/i.test(text)) stateIndicators.push("success indicator detected");

  return {
    pageType,
    layout: `Text-based analysis of ${visibleText.length} lines`,
    keyElements: [],
    stateIndicators,
    confidence: 0.4
  };
}
