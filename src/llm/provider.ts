/**
 * Shared LLM provider utilities used by planner, replanner, and diagnoser.
 * All three components speak the OpenAI-compatible chat completions API,
 * so the HTTP call, timeout handling, and JSON helpers live here once.
 */

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
  callerName = "LLM"
): Promise<LLMCallResult> {
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
      throw new Error(`${callerName} HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error(`${callerName} returned empty content.`);
    }

    const usage = parseOpenAIUsage((body as Record<string, unknown>).usage);
    return { content, usage, latencyMs: Date.now() - start };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${callerName} timed out after ${config.timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
  callerName = "LLM"
): Promise<LLMCallResult> {
  const baseUrl = config.baseUrl || "https://api.anthropic.com";
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
    return { content, usage, latencyMs: Date.now() - start };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${callerName} timed out after ${config.timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
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
