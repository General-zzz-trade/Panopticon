/**
 * Agent Message Bus — structured inter-agent communication.
 *
 * Enables real multi-agent collaboration beyond manual chaining:
 *   - Publish/subscribe by topic
 *   - Request/reply patterns
 *   - Shared key-value store for cross-agent state
 *   - Conversation threads between agents
 */

import { logModuleError } from "../core/module-logger";

export interface AgentMessage {
  id: string;
  topic: string;
  from: string;      // Agent ID
  to?: string;       // Target agent ID (undefined = broadcast)
  content: unknown;
  timestamp: string;
  /** Correlation ID for request/reply */
  correlationId?: string;
  /** Message type */
  type: "event" | "request" | "reply";
}

export type MessageListener = (msg: AgentMessage) => void | Promise<void>;

// ── Bus state ───────────────────────────────────────────────────────────

const subscribers = new Map<string, Set<MessageListener>>();  // topic → listeners
const pendingReplies = new Map<string, (reply: AgentMessage) => void>();  // correlationId → resolver
const messageHistory: AgentMessage[] = [];
const sharedStore = new Map<string, { value: unknown; setBy: string; at: string }>();

const MAX_HISTORY = 500;

// ── Publish/Subscribe ──────────────────────────────────────────────────

/**
 * Publish a message to a topic.
 */
export function publish(msg: Omit<AgentMessage, "id" | "timestamp">): string {
  const id = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const fullMsg: AgentMessage = {
    ...msg,
    id,
    timestamp: new Date().toISOString()
  };

  messageHistory.push(fullMsg);
  if (messageHistory.length > MAX_HISTORY) messageHistory.shift();

  // Deliver to subscribers
  const topicSubs = subscribers.get(msg.topic) ?? new Set();
  const broadcastSubs = subscribers.get("*") ?? new Set();

  for (const listener of [...topicSubs, ...broadcastSubs]) {
    if (msg.to && msg.to !== "*") {
      // Only deliver if subscriber matches target (via closure or filter)
    }
    try {
      const result = listener(fullMsg);
      if (result instanceof Promise) {
        result.catch(err => logModuleError("message-bus", "optional", err, `listener for ${msg.topic}`));
      }
    } catch (err) {
      logModuleError("message-bus", "optional", err, `listener for ${msg.topic}`);
    }
  }

  // If this is a reply, resolve pending
  if (msg.type === "reply" && msg.correlationId) {
    const resolver = pendingReplies.get(msg.correlationId);
    if (resolver) {
      resolver(fullMsg);
      pendingReplies.delete(msg.correlationId);
    }
  }

  return id;
}

/**
 * Subscribe to a topic. Returns unsubscribe function.
 * Use topic "*" for all messages.
 */
export function subscribe(topic: string, listener: MessageListener): () => void {
  let subs = subscribers.get(topic);
  if (!subs) {
    subs = new Set();
    subscribers.set(topic, subs);
  }
  subs.add(listener);
  return () => subs!.delete(listener);
}

// ── Request/Reply ──────────────────────────────────────────────────────

/**
 * Send a request and wait for a reply.
 */
export async function request(
  topic: string,
  from: string,
  to: string,
  content: unknown,
  timeoutMs: number = 30000
): Promise<AgentMessage | null> {
  const correlationId = `corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingReplies.delete(correlationId);
      resolve(null);
    }, timeoutMs);

    pendingReplies.set(correlationId, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });

    publish({ topic, from, to, content, type: "request", correlationId });
  });
}

/**
 * Reply to a request.
 */
export function reply(originalRequest: AgentMessage, from: string, content: unknown): void {
  publish({
    topic: originalRequest.topic,
    from,
    to: originalRequest.from,
    content,
    type: "reply",
    correlationId: originalRequest.correlationId
  });
}

// ── Shared Store ───────────────────────────────────────────────────────

/**
 * Set a value in shared agent store.
 */
export function setShared(key: string, value: unknown, setBy: string): void {
  sharedStore.set(key, { value, setBy, at: new Date().toISOString() });
  publish({
    topic: "shared.updated",
    from: setBy,
    content: { key, value },
    type: "event"
  });
}

/**
 * Get a value from shared agent store.
 */
export function getShared(key: string): unknown {
  return sharedStore.get(key)?.value;
}

/**
 * Get full entry (value + metadata).
 */
export function getSharedEntry(key: string): { value: unknown; setBy: string; at: string } | undefined {
  return sharedStore.get(key);
}

/**
 * List all shared keys.
 */
export function listSharedKeys(): string[] {
  return Array.from(sharedStore.keys());
}

// ── History & Debug ────────────────────────────────────────────────────

export function getRecentMessages(n: number = 50): AgentMessage[] {
  return messageHistory.slice(-n);
}

export function getMessagesForTopic(topic: string): AgentMessage[] {
  return messageHistory.filter(m => m.topic === topic);
}

export function clearBus(): void {
  subscribers.clear();
  pendingReplies.clear();
  messageHistory.length = 0;
  sharedStore.clear();
}
