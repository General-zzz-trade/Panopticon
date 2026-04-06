import { createHmac, randomBytes } from "node:crypto";

/* ------------------------------------------------------------------ */
/*  Webhook Manager                                                    */
/* ------------------------------------------------------------------ */

export interface WebhookConfig {
  id: string;
  url: string;
  events: string[];
  secret?: string;
  enabled: boolean;
  createdAt: string;
}

export type WebhookEvent =
  | "run.complete"
  | "run.failed"
  | "task.done"
  | "schedule.triggered";

const VALID_EVENTS: ReadonlySet<string> = new Set<string>([
  "run.complete",
  "run.failed",
  "task.done",
  "schedule.triggered",
]);

export function isValidEvent(event: string): boolean {
  return VALID_EVENTS.has(event);
}

/* ---- In-memory storage ---- */

const webhooks = new Map<string, WebhookConfig>();

/* ---- CRUD ---- */

export function registerWebhook(config: Omit<WebhookConfig, "id" | "createdAt"> & { id?: string }): WebhookConfig {
  const id = config.id ?? randomBytes(8).toString("hex");
  const record: WebhookConfig = {
    id,
    url: config.url,
    events: config.events.filter((e) => VALID_EVENTS.has(e)),
    secret: config.secret,
    enabled: config.enabled,
    createdAt: new Date().toISOString(),
  };
  webhooks.set(id, record);
  return record;
}

export function getWebhook(id: string): WebhookConfig | undefined {
  return webhooks.get(id);
}

export function listWebhooks(): WebhookConfig[] {
  return Array.from(webhooks.values());
}

export function deleteWebhook(id: string): boolean {
  return webhooks.delete(id);
}

/* ---- Delivery ---- */

interface DeliveryResult {
  webhookId: string;
  url: string;
  statusCode: number | null;
  success: boolean;
  error?: string;
}

const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 1;

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

async function deliver(webhook: WebhookConfig, event: string, payload: object): Promise<DeliveryResult> {
  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Event": event,
  };
  if (webhook.secret) {
    headers["X-Webhook-Signature"] = signPayload(body, webhook.secret);
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(webhook.url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        return { webhookId: webhook.id, url: webhook.url, statusCode: res.status, success: true };
      }
      // Non-ok response on last attempt
      if (attempt === MAX_RETRIES) {
        return {
          webhookId: webhook.id,
          url: webhook.url,
          statusCode: res.status,
          success: false,
          error: `HTTP ${res.status}`,
        };
      }
    } catch (err: unknown) {
      if (attempt === MAX_RETRIES) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          webhookId: webhook.id,
          url: webhook.url,
          statusCode: null,
          success: false,
          error: message,
        };
      }
    }
  }

  // Unreachable, but TypeScript needs it
  return { webhookId: "", url: "", statusCode: null, success: false, error: "unexpected" };
}

/**
 * Fire a webhook event to all matching, enabled webhooks.
 * Returns delivery results for each webhook that was attempted.
 */
export async function fireWebhook(event: string, payload: object): Promise<DeliveryResult[]> {
  const matching = Array.from(webhooks.values()).filter(
    (w) => w.enabled && w.events.includes(event)
  );
  if (matching.length === 0) return [];

  const results = await Promise.allSettled(
    matching.map((w) => deliver(w, event, payload))
  );

  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { webhookId: "", url: "", statusCode: null, success: false, error: String(r.reason) }
  );
}
