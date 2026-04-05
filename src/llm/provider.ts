/**
 * Shared LLM provider utilities used by planner, replanner, and diagnoser.
 * All three components speak the OpenAI-compatible chat completions API,
 * so the HTTP call, timeout handling, and JSON helpers live here once.
 */

import { logModuleError } from "../core/module-logger";
import { incCounter } from "../observability/metrics-store";

export interface LLMProviderConfig {
  provider: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
  apiKey?: string;
  baseUrl?: string;
}

export interface LLMMessage {
  role: "system" | "user";
  content: string;
}

export interface LLMCallResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
}

export const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  jitterFactor: 0.3
};

function isRetryableStatusCode(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    if (/fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network/i.test(error.message)) return true;
  }
  return false;
}

function computeDelay(attempt: number, config: RetryConfig, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) {
    return Math.min(retryAfterMs, config.maxDelayMs);
  }
  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, config.maxDelayMs);
  const jitter = capped * (1 + (Math.random() * 2 - 1) * config.jitterFactor);
  return Math.max(0, jitter);
}

function parseRetryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseOpenAIUsage(usage: unknown): { inputTokens: number; outputTokens: number } {
  if (!usage || typeof usage !== "object") return { inputTokens: 0, outputTokens: 0 };
  const u = usage as Record<string, unknown>;
  return {
    inputTokens: Number(u.prompt_tokens ?? 0),
    outputTokens: Number(u.completion_tokens ?? 0)
  };
}

export function parseAnthropicUsage(usage: unknown): { inputTokens: number; outputTokens: number } {
  if (!usage || typeof usage !== "object") return { inputTokens: 0, outputTokens: 0 };
  const u = usage as Record<string, unknown>;
  return {
    inputTokens: Number(u.input_tokens ?? 0),
    outputTokens: Number(u.output_tokens ?? 0)
  };
}

/**
 * Reads a provider config from environment variables using the given prefix.
 * e.g. prefix "LLM_PLANNER" reads LLM_PLANNER_PROVIDER, LLM_PLANNER_MODEL, etc.
 */
export function readProviderConfig(
  envPrefix: string,
  defaults: { model?: string; maxTokens?: number; temperature?: number } = {}
): LLMProviderConfig {
  const provider = process.env[`${envPrefix}_PROVIDER`]?.trim() ?? "";
  const defaultModel = provider === "anthropic" ? "claude-sonnet-4-20250514" : (defaults.model || "gpt-4.1-mini");
  const model = process.env[`${envPrefix}_MODEL`]?.trim() || defaultModel;
  const baseUrl = process.env[`${envPrefix}_BASE_URL`]?.trim();
  const explicitTemperature = process.env[`${envPrefix}_TEMPERATURE`];
  return {
    provider,
    model,
    timeoutMs: Number(process.env[`${envPrefix}_TIMEOUT_MS`] ?? 8000),
    maxTokens: Number(process.env[`${envPrefix}_MAX_TOKENS`] ?? defaults.maxTokens ?? 600),
    temperature: explicitTemperature !== undefined
      ? Number(explicitTemperature)
      : getDefaultTemperature(provider, model, baseUrl, defaults.temperature),
    apiKey: process.env[`${envPrefix}_API_KEY`]?.trim(),
    baseUrl
  };
}

/**
 * Calls an OpenAI-compatible chat completions endpoint and returns the raw
 * content string from the first choice.  Throws on HTTP errors, timeouts, or
 * empty responses.  `callerName` is used only in error messages.
 */
export async function callOpenAICompatible(
  config: LLMProviderConfig,
  messages: LLMMessage[],
  callerName = "LLM",
  retry: RetryConfig = DEFAULT_RETRY
): Promise<LLMCallResult> {
  let lastError: Error | undefined;
  let nextRetryAfterMs: number | undefined;

  for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
    if (attempt > 0) {
      incCounter("agent_llm_retries_total");
      await sleep(computeDelay(attempt - 1, retry, nextRetryAfterMs));
      nextRetryAfterMs = undefined;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const start = Date.now();
      const url = normalizeOpenAICompatibleBaseUrl(config.baseUrl);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model,
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          response_format: { type: "json_object" },
          messages
        })
      });

      if (!response.ok) {
        if (isRetryableStatusCode(response.status) && attempt < retry.maxRetries) {
          nextRetryAfterMs = parseRetryAfterMs(response);
          lastError = new Error(`${callerName} HTTP ${response.status}`);
          continue;
        }
        throw new Error(`${callerName} HTTP ${response.status}`);
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
      };
      const msg = body.choices?.[0]?.message;
      let content = msg?.content;

      // Handle thinking models (e.g., Kimi K2.5): if content is empty but
      // reasoning_content contains a JSON block, extract it as the content.
      if (!content && msg?.reasoning_content) {
        const jsonMatch = msg.reasoning_content.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
        if (jsonMatch) {
          content = jsonMatch[0];
        }
      }

      if (!content) {
        throw new Error(`${callerName} returned empty content.`);
      }

      const usage = parseOpenAIUsage((body as Record<string, unknown>).usage);
      const latencyMs = Date.now() - start;
      incCounter("agent_llm_calls_total");
      incCounter("agent_llm_input_tokens_total", usage.inputTokens);
      incCounter("agent_llm_output_tokens_total", usage.outputTokens);
      incCounter("agent_llm_latency_ms_total", latencyMs);
      return { content, usage, latencyMs };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastError = new Error(`${callerName} timed out after ${config.timeoutMs}ms.`);
        if (attempt < retry.maxRetries) continue;
        throw lastError;
      }
      if (isRetryableError(error) && attempt < retry.maxRetries) {
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error(`${callerName} failed after ${retry.maxRetries} retries.`);
}

/**
 * Calls the Anthropic Messages API and returns the raw text content from the
 * first content block.  Throws on HTTP errors, timeouts, or empty responses.
 * `callerName` is used only in error messages.
 *
 * The `messages` param follows the same `LLMMessage[]` convention used by
 * `callOpenAICompatible`.  System-role messages are extracted and sent via the
 * top-level `system` field; the remaining user messages are forwarded in the
 * `messages` array.
 */
export async function callAnthropic(
  config: LLMProviderConfig,
  messages: LLMMessage[],
  callerName = "LLM",
  retry: RetryConfig = DEFAULT_RETRY
): Promise<LLMCallResult> {
  const baseUrl = config.baseUrl || "https://api.anthropic.com";
  let lastError: Error | undefined;
  let nextRetryAfterMs: number | undefined;

  for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
    if (attempt > 0) {
      incCounter("agent_llm_retries_total");
      await sleep(computeDelay(attempt - 1, retry, nextRetryAfterMs));
      nextRetryAfterMs = undefined;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const start = Date.now();
      const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
      const userMessages = messages.filter((m) => m.role !== "system");

      const body: Record<string, unknown> = {
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        messages: userMessages.map((m) => ({ role: m.role, content: m.content }))
      };

      if (systemParts.length > 0) {
        body.system = systemParts.join("\n\n");
      }

      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey ?? "",
          "anthropic-version": "2023-06-01"
        },
        signal: controller.signal,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        if (isRetryableStatusCode(response.status) && attempt < retry.maxRetries) {
          nextRetryAfterMs = parseRetryAfterMs(response);
          lastError = new Error(`${callerName} HTTP ${response.status}`);
          continue;
        }
        throw new Error(`${callerName} HTTP ${response.status}`);
      }

      const responseBody = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const content = responseBody.content?.[0]?.text;

      if (!content) {
        throw new Error(`${callerName} returned empty content.`);
      }

      const usage = parseAnthropicUsage((responseBody as Record<string, unknown>).usage);
      const latencyMs = Date.now() - start;
      incCounter("agent_llm_calls_total");
      incCounter("agent_llm_input_tokens_total", usage.inputTokens);
      incCounter("agent_llm_output_tokens_total", usage.outputTokens);
      incCounter("agent_llm_latency_ms_total", latencyMs);
      return { content, usage, latencyMs };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastError = new Error(`${callerName} timed out after ${config.timeoutMs}ms.`);
        if (attempt < retry.maxRetries) continue;
        throw lastError;
      }
      if (isRetryableError(error) && attempt < retry.maxRetries) {
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error(`${callerName} failed after ${retry.maxRetries} retries.`);
}

export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    logModuleError("provider", "optional", error, "JSON parse failed");
    return undefined;
  }
}

/**
 * If the LLM wrapped its task array inside {"tasks":[...]}, unwrap it.
 * Otherwise return the content unchanged.
 */
export function unwrapTasksPayload(content: string): string {
  const parsed = safeJsonParse(content);
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    return JSON.stringify((parsed as { tasks: unknown[] }).tasks);
  }

  return content;
}

function getDefaultTemperature(
  provider: string,
  model: string,
  baseUrl: string | undefined,
  fallbackTemperature = 0.1
): number {
  if (provider === "openai-compatible" && isMoonshotK25(model, baseUrl)) {
    // Moonshot's kimi-k2.5 default thinking mode expects temperature 1.0.
    return 1;
  }

  return fallbackTemperature;
}

function isMoonshotK25(model: string, baseUrl: string | undefined): boolean {
  return /^kimi-k2\.5\b/i.test(model) && /moonshot|kimi/i.test(baseUrl ?? "");
}

function normalizeOpenAICompatibleBaseUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("OpenAI-compatible base URL is required.");
  }

  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }

  if (/\/v\d+$/i.test(trimmed)) {
    return `${trimmed}/chat/completions`;
  }

  return `${trimmed}/v1/chat/completions`;
}
