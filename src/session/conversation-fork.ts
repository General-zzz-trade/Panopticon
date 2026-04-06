/**
 * Conversation Fork — create branching conversations from a specific turn.
 */

import {
  getConversation,
  createConversation,
  type ConversationState,
  type ConversationTurn,
} from "./conversation";

// Track fork relationships: sourceId → list of fork metadata
const forkIndex = new Map<
  string,
  Array<{ id: string; forkedAt: number; createdAt: string }>
>();

/**
 * Fork a conversation, copying turns 0..fromTurnIndex into a new conversation.
 */
export function forkConversation(
  sourceId: string,
  fromTurnIndex: number
): { newId: string; turns: ConversationTurn[] } {
  const source = getConversation(sourceId);
  if (!source) {
    throw new Error(`Conversation not found: ${sourceId}`);
  }

  if (fromTurnIndex < 0 || fromTurnIndex >= source.turns.length) {
    throw new Error(
      `Invalid fromTurnIndex ${fromTurnIndex}; conversation has ${source.turns.length} turns`
    );
  }

  // Create a new conversation and copy turns 0..fromTurnIndex (inclusive)
  const forked = createConversation();
  const copiedTurns = source.turns.slice(0, fromTurnIndex + 1).map((t, i) => ({
    ...t,
    index: i,
  }));
  forked.turns = copiedTurns;

  // Record in fork index
  if (!forkIndex.has(sourceId)) {
    forkIndex.set(sourceId, []);
  }
  forkIndex.get(sourceId)!.push({
    id: forked.id,
    forkedAt: fromTurnIndex,
    createdAt: forked.createdAt,
  });

  return { newId: forked.id, turns: copiedTurns };
}

/**
 * List all forks of a given conversation.
 */
export function listForks(
  sourceId: string
): Array<{ id: string; forkedAt: number; turnCount: number }> {
  const forks = forkIndex.get(sourceId) ?? [];
  return forks.map((f) => {
    const conv = getConversation(f.id);
    return {
      id: f.id,
      forkedAt: f.forkedAt,
      turnCount: conv?.turns.length ?? 0,
    };
  });
}
