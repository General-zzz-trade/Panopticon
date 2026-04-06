/**
 * Chat endpoint — LLM-powered conversational layer.
 *
 * This is the missing piece that makes the agent feel like Claude/GPT.
 * It classifies user intent and either:
 *   1. Responds directly via LLM (chat, questions, greetings)
 *   2. Routes to the task execution pipeline (actionable goals)
 *   3. Combines both: executes tasks then summarizes conversationally
 */

import type { FastifyInstance } from "fastify";
import {
  readProviderConfig,
  callOpenAICompatible,
  type LLMProviderConfig,
  type LLMMessage,
} from "../../llm/provider";
import { submitJob } from "../../worker/pool";
import { getOrCreateEmitter, getBufferedEvents, isClosed, publishEvent } from "../../streaming/event-bus";
import { ensureBus } from "../../streaming/event-bus";
import { getRun } from "../../db/runs-repo";
import { logModuleError } from "../../core/module-logger";

// ── Intent classification ──────────────────────────────────────

type Intent = "chat" | "task" | "hybrid";

interface ClassificationResult {
  intent: Intent;
  taskGoal?: string;      // cleaned goal for task pipeline (if task/hybrid)
  chatResponse?: string;  // direct response (if chat)
}

const TASK_KEYWORDS = /\b(open|click|type|navigate|go to|visit|browse|fill|submit|assert|check|verify|scroll|hover|run|execute|start|wait|screenshot|extract|select|download|upload|fetch|search|read file|write file|list files|http|api|curl|grep|find)\b/i;
const URL_PATTERN = /https?:\/\/|www\./i;
const OSINT_KEYWORDS = /\b(osint|whois|dns lookup|subdomain|port scan|reconnaissance|recon|investigate|fingerprint|geolocation|geoip|wayback|tech stack|certificate transparency|dork|email validation|username search|identity search|域名查询|端口扫描|子域名|情报收集|侦查|信息收集|渗透|枚举)\b/i;

function classifyIntent(message: string): Intent {
  const trimmed = message.trim();

  // OSINT requests → always treat as task
  if (OSINT_KEYWORDS.test(trimmed)) return "task";

  // Obvious task: has URLs or explicit action verbs
  if (URL_PATTERN.test(trimmed)) return "task";
  if (TASK_KEYWORDS.test(trimmed) && trimmed.split(/\s+/).length >= 3) return "task";

  // Obvious chat: greetings, questions about the agent, short messages
  if (/^(hi|hello|hey|yo|sup|thanks|thank you|bye|good\s*(morning|evening|night))/i.test(trimmed)) return "chat";
  if (/^(who|what|when|where|why|how|can you|do you|are you|is there|tell me)/i.test(trimmed) && !TASK_KEYWORDS.test(trimmed)) return "chat";
  if (trimmed.split(/\s+/).length <= 4 && !TASK_KEYWORDS.test(trimmed)) return "chat";

  // Hybrid: could be either, let LLM decide
  if (trimmed.split(/\s+/).length < 8 && !URL_PATTERN.test(trimmed)) return "chat";

  return "task";
}

// ── LLM Chat ───────────────────────────────────────────────────

function getChatConfig(customOpts?: Record<string, unknown>): LLMProviderConfig | null {
  // If custom model config provided by frontend, use it
  if (customOpts?.customModel && customOpts.apiKey && customOpts.baseUrl) {
    return {
      provider: "openai-compatible",
      model: String(customOpts.model || ""),
      apiKey: String(customOpts.apiKey),
      baseUrl: String(customOpts.baseUrl),
      timeoutMs: 120000,
      maxTokens: 2048,
      temperature: 0.7,
    };
  }
  // Default: reuse planner LLM config from env
  const config = readProviderConfig("LLM_PLANNER", {
    maxTokens: 2048,
    temperature: 0.7,
  });
  if (!config.apiKey) return null;
  return { ...config, maxTokens: 2048 };
}

const CHAT_SYSTEM_PROMPT = `You are Panopticon, an AI-powered open-source intelligence platform specialized in reconnaissance and investigation.

Your core capabilities (no API keys required):
- **Domain Recon**: WHOIS lookup, DNS enumeration, subdomain discovery via certificate transparency, zone transfer testing
- **Network Scan**: TCP port scanning, service banner grabbing, IP geolocation, traceroute, HTTP security header audit
- **Identity Lookup**: Username enumeration across 37+ platforms (GitHub, Twitter, Reddit, LinkedIn, Bilibili, etc.), email MX validation, SMTP verification, disposable email detection
- **Web Intelligence**: Technology stack detection (50+ signatures), Wayback Machine history, Google dork generation, robots.txt/sitemap analysis
- **Metadata Extraction**: EXIF GPS coordinates from images, PDF metadata, HTTP fingerprinting
- **Intelligence Correlation**: Entity relationship graphing, cluster analysis, timeline reconstruction
- **Risk Assessment**: Automated vulnerability scoring and security recommendations

When users ask OSINT questions, provide expert guidance on reconnaissance methodology.
When users request an investigation, execute it using your built-in OSINT modules.
Use markdown formatting. Be precise and professional. Present findings in structured tables when possible.`;

async function callChatLLM(
  config: LLMProviderConfig,
  userMessage: string,
  conversationContext: LLMMessage[] = []
): Promise<string> {
  const messages: LLMMessage[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
  ];

  // Add recent conversation context (alternating user/assistant pairs)
  for (const msg of conversationContext.slice(-6)) {
    messages.push(msg);
  }

  messages.push({ role: "user", content: userMessage });

  // Call LLM — override to NOT use JSON mode
  const url = normalizeBaseUrl(config.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
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
        messages,
        // NO response_format: json_object — we want natural text
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`LLM HTTP ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("LLM returned empty response");
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBaseUrl(baseUrl?: string): string {
  if (!baseUrl) return "https://api.openai.com/v1/chat/completions";
  let url = baseUrl;
  if (url.endsWith("/")) url = url.slice(0, -1);
  if (!url.endsWith("/chat/completions")) {
    url = url.replace(/\/v1$/, "") + "/v1/chat/completions";
  }
  return url;
}

// ── Streaming chat response via SSE ────────────────────────────

async function streamChatLLM(
  config: LLMProviderConfig,
  userMessage: string,
  conversationContext: LLMMessage[],
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: string) => void
): Promise<void> {
  const messages: LLMMessage[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
  ];
  for (const msg of conversationContext.slice(-6)) {
    messages.push(msg);
  }
  messages.push({ role: "user", content: userMessage });

  const url = normalizeBaseUrl(config.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
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
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`LLM HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onChunk(delta);
          }
        } catch {
          // Skip malformed SSE chunks
        }
      }
    }

    onDone(fullText);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onError(msg);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Route ──────────────────────────────────────────────────────

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /chat — intelligent conversational endpoint
   *
   * Body: { message: string, conversationId?: string, options?: { stream?: boolean } }
   *
   * This is the MAIN endpoint the frontend should use instead of POST /runs.
   * It classifies intent and routes appropriately:
   *   - chat → LLM direct response (streamed via SSE)
   *   - task → submits to worker queue, returns runId for SSE event stream
   *   - hybrid → LLM response + optional task execution
   */
  app.post<{
    Body: {
      message: string;
      conversationId?: string;
      options?: Record<string, unknown>;
    };
  }>(
    "/chat",
    {
      schema: {
        body: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string", minLength: 1, maxLength: 4000 },
            conversationId: { type: "string" },
            options: { type: "object" },
          },
        },
      },
    },
    async (request, reply) => {
      const { message, conversationId, options = {} } = request.body;
      const tenantId = request.tenantId ?? "default";

      // Classify intent
      const intent = classifyIntent(message);

      if (intent === "task") {
        // Route to task pipeline (existing flow)
        const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
        ensureBus(runId);
        if (conversationId) {
          (options as Record<string, unknown>).conversationId = conversationId;
        }
        submitJob(runId, message, options as Record<string, unknown>, tenantId);
        return reply.code(202).send({
          type: "task",
          runId,
          status: "pending",
          message: "Executing task...",
        });
      }

      // Chat mode: respond via LLM (use custom model if provided by frontend)
      const config = getChatConfig(options as Record<string, unknown>);
      if (!config) {
        // No LLM configured — return a helpful message
        return reply.send({
          type: "chat",
          message: "I'm configured as a task executor. Please give me a task like:\n\n- Go to example.com and summarize it\n- Fetch https://api.github.com/repos/nodejs/node\n- Run command: ls -la\n\nTo enable conversational mode, configure `LLM_PLANNER_API_KEY` in your environment.",
        });
      }

      // Gather conversation context as structured user/assistant message pairs
      const context: LLMMessage[] = [];
      if (conversationId) {
        try {
          const { getConversation } = await import("../../session/conversation");
          const conv = getConversation(conversationId);
          if (conv?.turns) {
            for (const turn of conv.turns.slice(-3)) {
              if (turn.goal) {
                context.push({ role: "user", content: turn.goal });
              }
              if (turn.summary) {
                context.push({ role: "assistant", content: turn.summary });
              }
            }
          }
        } catch {}
      }

      // Stream response via SSE
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });

      const sendSSE = (eventType: string, data: unknown) => {
        reply.raw.write(`data: ${JSON.stringify({ type: eventType, ...data as object })}\n\n`);
      };

      sendSSE("chat_start", { timestamp: new Date().toISOString() });

      await streamChatLLM(
        config,
        message,
        context,
        (chunk) => {
          sendSSE("chat_chunk", { content: chunk });
        },
        (fullText) => {
          sendSSE("chat_done", { content: fullText, success: true });
          reply.raw.end();
        },
        (error) => {
          // Streaming failed — try non-streaming fallback
          logModuleError("chat", "optional", error, "streaming LLM call");
          callChatLLM(config!, message, context)
            .then((text) => {
              sendSSE("chat_done", { content: text, success: true });
              reply.raw.end();
            })
            .catch((fallbackErr) => {
              sendSSE("chat_done", {
                content: "Sorry, I encountered an error: " + String(fallbackErr).slice(0, 200),
                success: false,
              });
              reply.raw.end();
            });
        }
      );
    }
  );
}
