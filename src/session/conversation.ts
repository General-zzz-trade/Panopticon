/**
 * Conversation Session — persistent multi-turn agent interaction.
 * Keeps browser and world state alive between goals,
 * enabling natural back-and-forth like:
 *   user: "open dashboard"  → agent executes
 *   user: "click settings"  → agent continues on same page
 *   user: "screenshot"      → agent captures current state
 */

import type { RunContext, AgentTask } from "../types";
import type { BrowserSession } from "../browser";
import type { WorldStateSnapshot } from "../cognition/types";
import type { CausalGraph } from "../world-model/causal-graph";
import { createCausalGraph } from "../world-model/causal-graph";
import { extractCausalTransitions } from "../world-model/extractor";
import { logModuleError } from "../core/module-logger";

export interface ConversationState {
  id: string;
  turns: ConversationTurn[];
  browserSession?: BrowserSession;
  worldState?: WorldStateSnapshot;
  causalGraph: CausalGraph;
  createdAt: string;
  lastActiveAt: string;
}

export interface ConversationTurn {
  index: number;
  goal: string;
  runId: string;
  success: boolean;
  summary: string;
  timestamp: string;
}

export function createConversation(id?: string): ConversationState {
  return {
    id: id ?? `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    turns: [],
    causalGraph: createCausalGraph(),
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString()
  };
}

/**
 * Record a completed turn in the conversation.
 */
export function recordTurn(
  conversation: ConversationState,
  context: RunContext
): ConversationTurn {
  const turn: ConversationTurn = {
    index: conversation.turns.length,
    goal: context.goal,
    runId: context.runId,
    success: context.result?.success ?? false,
    summary: context.result?.message?.slice(0, 200) ?? "",
    timestamp: new Date().toISOString()
  };

  conversation.turns.push(turn);
  conversation.lastActiveAt = turn.timestamp;

  // Carry forward browser session and world state
  if (context.browserSession) {
    conversation.browserSession = context.browserSession;
  }
  if (context.worldState) {
    conversation.worldState = context.worldState;
  }

  // Accumulate causal transitions
  extractCausalTransitions(context, conversation.causalGraph);

  return turn;
}

/**
 * Build context for a new goal that continues the conversation.
 * Injects previous state so the agent doesn't start from scratch.
 */
export function buildContinuationContext(
  conversation: ConversationState
): {
  browserSession?: BrowserSession;
  worldState?: WorldStateSnapshot;
  previousTurns: string;
} {
  const previousTurns = conversation.turns
    .slice(-5) // last 5 turns for context
    .map(t => `[Turn ${t.index}] ${t.success ? "✓" : "✗"} ${t.goal}`)
    .join("\n");

  return {
    browserSession: conversation.browserSession,
    worldState: conversation.worldState,
    previousTurns
  };
}

/**
 * Check if the conversation is still active (browser alive).
 */
export function isConversationActive(conversation: ConversationState): boolean {
  if (!conversation.browserSession?.page) return false;
  try {
    // Check if page is still connected
    conversation.browserSession.page.url();
    return true;
  } catch (error) {
    logModuleError("conversation", "optional", error, "checking if browser page is still connected");
    return false;
  }
}

/**
 * Get conversation summary for display.
 */
export function getConversationSummary(conversation: ConversationState): string {
  const totalTurns = conversation.turns.length;
  const successTurns = conversation.turns.filter(t => t.success).length;
  const lastGoal = conversation.turns[conversation.turns.length - 1]?.goal ?? "none";
  const active = conversation.browserSession ? "active" : "no browser";

  return `Conversation ${conversation.id}: ${totalTurns} turns (${successTurns} success), last: "${lastGoal}", status: ${active}`;
}

/**
 * End a conversation and clean up resources.
 */
export async function endConversation(conversation: ConversationState): Promise<void> {
  // Don't close browser here — let the caller decide
  conversation.browserSession = undefined;
  conversation.worldState = undefined;
}
