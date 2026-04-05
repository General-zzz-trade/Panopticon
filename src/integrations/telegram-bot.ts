/**
 * Telegram Bot integration — long-polls Telegram Bot API and forwards
 * messages to runGoal(). Uses only Node.js built-in `https` module.
 */

import https from "node:https";
import { runGoal, type RunOptions } from "../core/runtime";

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

let polling = false;
const chatModes = new Map<number, "react" | "cli" | "sequential">();

/* ------------------------------------------------------------------ */
/*  HTTP helpers (Node built-in https only)                            */
/* ------------------------------------------------------------------ */

function httpsRequest(
  url: string,
  options: https.RequestOptions,
  body?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    });
    req.on("error", reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/*  Telegram API wrappers                                              */
/* ------------------------------------------------------------------ */

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
}

async function pollUpdates(
  token: string,
  offset: number
): Promise<TelegramUpdate[]> {
  const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=30`;
  const raw = await httpsRequest(url, { method: "GET" });
  const parsed: { ok: boolean; result: TelegramUpdate[] } = JSON.parse(raw);
  if (!parsed.ok) return [];
  return parsed.result;
}

async function sendMessage(
  token: string,
  chatId: number,
  text: string
): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text });
  await httpsRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  }, body);
}

/* ------------------------------------------------------------------ */
/*  Execution-mode detection                                           */
/* ------------------------------------------------------------------ */

const CLI_PREFIXES = [
  "ls", "cd", "grep", "git", "cat", "mkdir", "rm", "mv", "cp",
  "echo", "pwd", "chmod", "chown", "curl", "wget", "npm",
  "node", "docker", "kubectl",
];

const DSL_KEYWORDS = [
  "open page", "click", "assert", "type into", "scroll", "hover",
  "wait for", "screenshot",
];

export function detectExecutionMode(text: string): "react" | "cli" | "sequential" {
  const trimmed = text.trim().toLowerCase();

  // CLI: starts with a known shell command
  const firstWord = trimmed.split(/\s+/)[0];
  if (CLI_PREFIXES.includes(firstWord)) {
    return "cli";
  }

  // Sequential: contains DSL keywords
  for (const kw of DSL_KEYWORDS) {
    if (trimmed.includes(kw)) {
      return "sequential";
    }
  }

  // React: mentions "go to" or contains a URL
  if (/\bgo\s+to\b/.test(trimmed) || /https?:\/\//.test(trimmed)) {
    return "react";
  }

  return "react";
}

/* ------------------------------------------------------------------ */
/*  Message handler                                                    */
/* ------------------------------------------------------------------ */

async function handleMessage(
  token: string,
  chatId: number,
  text: string
): Promise<void> {
  // Handle /mode command
  const modeMatch = text.match(/^\/mode\s+(react|cli|sequential)$/i);
  if (modeMatch) {
    const mode = modeMatch[1].toLowerCase() as "react" | "cli" | "sequential";
    chatModes.set(chatId, mode);
    await sendMessage(token, chatId, `Execution mode set to: ${mode}`);
    return;
  }

  // Determine mode: explicit override or auto-detect
  const mode = chatModes.get(chatId) ?? detectExecutionMode(text);

  await sendMessage(token, chatId, `Running goal in "${mode}" mode...`);

  try {
    const options: RunOptions = { executionMode: mode };
    const ctx = await runGoal(text, options);

    const success = ctx.terminationReason === "success";
    const summary = ctx.result?.message ?? (success ? "Goal completed." : "Goal failed.");
    const taskCount = ctx.tasks.length;
    const status = success ? "Success" : "Failed";

    const reply = [
      `${status}: ${summary}`,
      `Tasks executed: ${taskCount}`,
      ctx.result?.error ? `Error: ${ctx.result.error}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await sendMessage(token, chatId, reply);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(token, chatId, `Error: ${msg}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function startTelegramBot(token: string): Promise<void> {
  if (polling) return;
  polling = true;

  let offset = 0;

  while (polling) {
    try {
      const updates = await pollUpdates(token, offset);

      for (const update of updates) {
        offset = update.update_id + 1;
        const chatId = update.message?.chat.id;
        const text = update.message?.text;
        if (chatId !== undefined && text !== undefined) {
          // Fire-and-forget so we keep polling while processing
          handleMessage(token, chatId, text).catch(() => {
            /* swallow per-message errors to keep the loop alive */
          });
        }
      }
    } catch {
      // Network hiccup — wait briefly before retrying
      if (polling) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
}

export function stopTelegramBot(): void {
  polling = false;
}
