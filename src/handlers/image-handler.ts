/**
 * Image Understanding Handler — analyzes images using vision-capable LLMs.
 *
 * Accepts an image file path, sends it to a vision-capable LLM (Anthropic or
 * OpenAI-compatible), and returns structured analysis including description,
 * key elements, visible text, and confidence score.
 *
 * Falls back to metadata-only analysis when no vision LLM is available.
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import type { AgentTask, RunContext } from "../types";
import type { TaskExecutionOutput } from "./browser-handler";
import { readProviderConfig, type LLMProviderConfig } from "../llm/provider";
import { logModuleError } from "../core/module-logger";
import { incCounter } from "../observability/metrics-store";
import { registerTool } from "../tools/registry";

export interface ImageAnalysis {
  description: string;
  elements: string[];
  text: string[];
  confidence: number;
}

const IMAGE_ANALYSIS_PROMPT = `Analyze this image and return JSON:
{
  "description": "what the image shows",
  "elements": ["list", "of", "key", "elements"],
  "text": ["any", "text", "visible"],
  "confidence": 0.9
}
If there's a specific question, answer it in the description.`;

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * Determine MIME type from file extension.
 */
export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "image/png";
}

/**
 * Check if image analysis is available (needs vision LLM).
 * Checks LLM_VISION_* or ANTHROPIC_API_KEY env vars.
 */
export function isImageAnalysisAvailable(): boolean {
  const visionKey = process.env.LLM_VISION_API_KEY?.trim();
  if (visionKey) return true;

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) return true;

  return false;
}

/**
 * Get the vision LLM provider config, falling back to Anthropic defaults.
 */
function getVisionConfig(): LLMProviderConfig {
  // Try explicit LLM_VISION_* config first
  const visionConfig = readProviderConfig("LLM_VISION", {
    model: "claude-sonnet-4-20250514",
    maxTokens: 1024,
    temperature: 0.1,
  });

  if (visionConfig.apiKey) {
    return visionConfig;
  }

  // Fall back to ANTHROPIC_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    return {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      timeoutMs: 30000,
      maxTokens: 1024,
      temperature: 0.1,
      apiKey: anthropicKey,
      baseUrl: "https://api.anthropic.com",
    };
  }

  throw new Error("No vision LLM API key configured. Set LLM_VISION_API_KEY or ANTHROPIC_API_KEY.");
}

/**
 * Call the Anthropic Messages API with image content.
 * Uses the multimodal content block format required for vision.
 */
async function callAnthropicVision(
  config: LLMProviderConfig,
  base64Data: string,
  mimeType: string,
  prompt: string
): Promise<string> {
  const baseUrl = config.baseUrl || "https://api.anthropic.com";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const start = Date.now();
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey ?? "",
        "anthropic-version": "2023-06-01",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType,
                  data: base64Data,
                },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Vision LLM HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const content = body.content?.[0]?.text;
    if (!content) {
      throw new Error("Vision LLM returned empty content.");
    }

    const latencyMs = Date.now() - start;
    const inputTokens = body.usage?.input_tokens ?? 0;
    const outputTokens = body.usage?.output_tokens ?? 0;
    incCounter("agent_llm_calls_total");
    incCounter("agent_llm_input_tokens_total", inputTokens);
    incCounter("agent_llm_output_tokens_total", outputTokens);
    incCounter("agent_llm_latency_ms_total", latencyMs);

    return content;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call an OpenAI-compatible API with image content.
 * Uses the multimodal content format for vision models.
 */
async function callOpenAIVision(
  config: LLMProviderConfig,
  base64Data: string,
  mimeType: string,
  prompt: string
): Promise<string> {
  const baseUrl = (config.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("OpenAI-compatible base URL is required.");
  }

  const url = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const start = Date.now();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Data}`,
                },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Vision LLM HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Vision LLM returned empty content.");
    }

    const latencyMs = Date.now() - start;
    const inputTokens = body.usage?.prompt_tokens ?? 0;
    const outputTokens = body.usage?.completion_tokens ?? 0;
    incCounter("agent_llm_calls_total");
    incCounter("agent_llm_input_tokens_total", inputTokens);
    incCounter("agent_llm_output_tokens_total", outputTokens);
    incCounter("agent_llm_latency_ms_total", latencyMs);

    return content;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parse the LLM response into a structured ImageAnalysis.
 * Handles both clean JSON and JSON embedded in markdown code blocks.
 */
function parseAnalysisResponse(raw: string): ImageAnalysis {
  // Try to extract JSON from markdown code blocks first
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw.trim();

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    return {
      description: typeof parsed.description === "string" ? parsed.description : raw,
      elements: Array.isArray(parsed.elements) ? parsed.elements.map(String) : [],
      text: Array.isArray(parsed.text) ? parsed.text.map(String) : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch {
    // If JSON parsing fails, return the raw text as description
    return {
      description: raw,
      elements: [],
      text: [],
      confidence: 0.3,
    };
  }
}

/**
 * For providers that don't support image input natively,
 * fall back to describing the image metadata (file size, dimensions via
 * identify command if available).
 */
function fallbackImageInfo(imagePath: string): ImageAnalysis {
  const stat = fs.statSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const sizeKB = Math.round(stat.size / 1024);

  let dimensions = "unknown";
  try {
    const result = execFileSync("identify", ["-format", "%wx%h", imagePath], {
      timeout: 5000,
      encoding: "utf-8",
    });
    dimensions = result.trim();
  } catch {
    // identify not available — skip dimensions
  }

  return {
    description: `Image file: ${path.basename(imagePath)} (${ext.replace(".", "").toUpperCase()}, ${sizeKB}KB, ${dimensions})`,
    elements: [],
    text: [],
    confidence: 0.1,
  };
}

/**
 * Analyze an image file using a vision-capable LLM.
 *
 * 1. Reads the file as base64
 * 2. Determines MIME type from extension
 * 3. Sends to LLM with vision prompt
 * 4. Parses structured response
 */
export async function analyzeImage(imagePath: string, question?: string): Promise<ImageAnalysis> {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image file not found: ${imagePath}`);
  }

  if (!isImageAnalysisAvailable()) {
    return fallbackImageInfo(imagePath);
  }

  const fileBuffer = fs.readFileSync(imagePath);
  const base64Data = fileBuffer.toString("base64");
  const mimeType = getMimeType(imagePath);

  const prompt = question
    ? `${IMAGE_ANALYSIS_PROMPT}\n\nSpecific question: ${question}`
    : IMAGE_ANALYSIS_PROMPT;

  const config = getVisionConfig();

  try {
    let rawResponse: string;

    if (config.provider === "anthropic" || (!config.provider && !config.baseUrl)) {
      rawResponse = await callAnthropicVision(config, base64Data, mimeType, prompt);
    } else {
      rawResponse = await callOpenAIVision(config, base64Data, mimeType, prompt);
    }

    return parseAnalysisResponse(rawResponse);
  } catch (error) {
    logModuleError("image-handler", "optional", error, "vision LLM call failed, using fallback");
    return fallbackImageInfo(imagePath);
  }
}

/**
 * Handle image task from executor.
 *
 * Supported task types:
 * - analyze_image:           payload = { path, question? }
 * - describe_image:          payload = { path }
 * - extract_text_from_image: payload = { path }
 */
export async function handleImageTask(
  context: RunContext,
  task: AgentTask
): Promise<TaskExecutionOutput> {
  const imagePath = String(task.payload.path ?? "");
  if (!imagePath) {
    throw new Error("Image task requires a 'path' payload field.");
  }

  let question: string | undefined;

  switch (task.type as string) {
    case "analyze_image":
      question = task.payload.question ? String(task.payload.question) : undefined;
      break;
    case "describe_image":
      question = "Provide a detailed description of this image.";
      break;
    case "extract_text_from_image":
      question = "Extract all visible text from this image. List each text element separately.";
      break;
    default:
      throw new Error(`Unknown image task type: ${task.type}`);
  }

  const analysis = await analyzeImage(imagePath, question);

  const summary = [
    `Image analysis: ${analysis.description}`,
    analysis.elements.length > 0 ? `Elements: ${analysis.elements.join(", ")}` : null,
    analysis.text.length > 0 ? `Text found: ${analysis.text.join("; ")}` : null,
    `Confidence: ${analysis.confidence}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    summary,
    stateHints: [`image_analyzed:${path.basename(imagePath)}`],
    observationHints: [
      `Image description: ${analysis.description}`,
      ...analysis.text.map((t) => `Visible text: ${t}`),
    ],
  };
}

// Register image tools
registerTool({
  name: "analyze_image",
  category: "vision",
  description: "Analyze an image file",
  parameters: [
    { name: "path", type: "string", required: true, description: "Image file path" },
    { name: "question", type: "string", required: false, description: "Specific question about the image" },
  ],
  verificationStrategy: "error",
  mutating: false,
  requiresApproval: false,
});

registerTool({
  name: "describe_image",
  category: "vision",
  description: "Describe an image file in detail",
  parameters: [
    { name: "path", type: "string", required: true, description: "Image file path" },
  ],
  verificationStrategy: "error",
  mutating: false,
  requiresApproval: false,
});

registerTool({
  name: "extract_text_from_image",
  category: "vision",
  description: "Extract visible text from an image file",
  parameters: [
    { name: "path", type: "string", required: true, description: "Image file path" },
  ],
  verificationStrategy: "error",
  mutating: false,
  requiresApproval: false,
});
