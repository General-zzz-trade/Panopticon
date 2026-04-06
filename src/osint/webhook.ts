/**
 * Webhook Notifications — send investigation results to Slack/Discord/Telegram/email/generic
 */

export type WebhookType = "slack" | "discord" | "telegram" | "generic";

export interface WebhookConfig {
  id: string;
  type: WebhookType;
  url: string;
  name: string;
  enabled: boolean;
  events: ("investigation_complete" | "threat_detected" | "monitor_alert" | "breach_found")[];
  token?: string;      // For Telegram bot token
  chatId?: string;     // For Telegram chat ID
}

export interface WebhookPayload {
  event: string;
  target: string;
  riskLevel?: string;
  summary: string;
  details?: Record<string, any>;
  timestamp: string;
}

// ── In-memory webhook store ─────────────────────────────

const webhooks = new Map<string, WebhookConfig>();

export function addWebhook(config: Omit<WebhookConfig, "id">): WebhookConfig {
  const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const webhook = { id, ...config };
  webhooks.set(id, webhook);
  return webhook;
}

export function listWebhooks(): WebhookConfig[] {
  return Array.from(webhooks.values());
}

export function removeWebhook(id: string): boolean {
  return webhooks.delete(id);
}

// ── Send to Slack ───────────────────────────────────────

async function sendSlack(url: string, payload: WebhookPayload): Promise<boolean> {
  try {
    const riskEmoji = { critical: ":rotating_light:", high: ":warning:", medium: ":large_yellow_circle:", low: ":white_check_mark:" }[payload.riskLevel || ""] || ":mag:";

    const body = {
      blocks: [
        { type: "header", text: { type: "plain_text", text: `${riskEmoji} OSINT Alert: ${payload.event}` } },
        { type: "section", fields: [
          { type: "mrkdwn", text: `*Target:*\n\`${payload.target}\`` },
          { type: "mrkdwn", text: `*Risk:*\n${(payload.riskLevel || "N/A").toUpperCase()}` },
        ]},
        { type: "section", text: { type: "mrkdwn", text: payload.summary } },
        { type: "context", elements: [{ type: "mrkdwn", text: `Panopticon | ${payload.timestamp}` }] },
      ],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch { return false; }
}

// ── Send to Discord ─────────────────────────────────────

async function sendDiscord(url: string, payload: WebhookPayload): Promise<boolean> {
  try {
    const color = { critical: 0xef4444, high: 0xf97316, medium: 0xf59e0b, low: 0x22c55e }[payload.riskLevel || ""] || 0x6366f1;

    const body = {
      embeds: [{
        title: `OSINT Alert: ${payload.event}`,
        description: payload.summary,
        color,
        fields: [
          { name: "Target", value: `\`${payload.target}\``, inline: true },
          { name: "Risk", value: (payload.riskLevel || "N/A").toUpperCase(), inline: true },
        ],
        footer: { text: `Panopticon | ${payload.timestamp}` },
      }],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch { return false; }
}

// ── Send to Telegram ────────────────────────────────────

async function sendTelegram(token: string, chatId: string, payload: WebhookPayload): Promise<boolean> {
  try {
    const riskEmoji = { critical: "\u{1F6A8}", high: "\u{26A0}", medium: "\u{1F7E1}", low: "\u{2705}" }[payload.riskLevel || ""] || "\u{1F50D}";

    const text = `${riskEmoji} *OSINT Alert: ${payload.event}*\n\n` +
      `*Target:* \`${payload.target}\`\n` +
      `*Risk:* ${(payload.riskLevel || "N/A").toUpperCase()}\n\n` +
      `${payload.summary}\n\n` +
      `_Panopticon | ${payload.timestamp}_`;

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch { return false; }
}

// ── Send to Generic URL ─────────────────────────────────

async function sendGeneric(url: string, payload: WebhookPayload): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch { return false; }
}

// ── Dispatch to all matching webhooks ───────────────────

export async function dispatchWebhook(event: WebhookConfig["events"][0], payload: WebhookPayload): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;

  for (const webhook of webhooks.values()) {
    if (!webhook.enabled || !webhook.events.includes(event)) continue;

    let ok = false;
    if (webhook.type === "slack") ok = await sendSlack(webhook.url, payload);
    else if (webhook.type === "discord") ok = await sendDiscord(webhook.url, payload);
    else if (webhook.type === "telegram" && webhook.token && webhook.chatId) ok = await sendTelegram(webhook.token, webhook.chatId, payload);
    else ok = await sendGeneric(webhook.url, payload);

    if (ok) sent++; else failed++;
  }

  return { sent, failed };
}
