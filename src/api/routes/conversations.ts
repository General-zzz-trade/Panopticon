import type { FastifyInstance } from "fastify";
import {
  createConversation,
  recordTurn,
  buildContinuationContext,
  endConversation,
  getConversationSummary,
  type ConversationState
} from "../../session/conversation";
import { runGoal } from "../../core/runtime";

// In-memory conversation store (keyed by conversation ID)
const conversations = new Map<string, ConversationState>();

export async function conversationsRoutes(app: FastifyInstance): Promise<void> {
  // POST /conversations — create a new conversation session
  app.post("/conversations", async (_request, reply) => {
    const conversation = createConversation();
    conversations.set(conversation.id, conversation);
    return reply.code(201).send({
      id: conversation.id,
      createdAt: conversation.createdAt
    });
  });

  // GET /conversations — list active conversations
  app.get("/conversations", async (_request, reply) => {
    const list = Array.from(conversations.values()).map(c => ({
      id: c.id,
      turns: c.turns.length,
      summary: getConversationSummary(c),
      createdAt: c.createdAt,
      lastActiveAt: c.lastActiveAt
    }));
    return reply.send({ conversations: list });
  });

  // GET /conversations/:id — get conversation details
  app.get<{ Params: { id: string } }>("/conversations/:id", async (request, reply) => {
    const conversation = conversations.get(request.params.id);
    if (!conversation) {
      return reply.code(404).send({ error: "Conversation not found" });
    }
    return reply.send({
      id: conversation.id,
      turns: conversation.turns,
      summary: getConversationSummary(conversation),
      createdAt: conversation.createdAt,
      lastActiveAt: conversation.lastActiveAt
    });
  });

  // POST /conversations/:id/turns — execute a goal within the conversation
  app.post<{ Params: { id: string }; Body: { goal: string } }>("/conversations/:id/turns", {
    schema: {
      body: {
        type: "object",
        required: ["goal"],
        properties: { goal: { type: "string", minLength: 1 } }
      }
    }
  }, async (request, reply) => {
    const conversation = conversations.get(request.params.id);
    if (!conversation) {
      return reply.code(404).send({ error: "Conversation not found" });
    }

    const continuation = buildContinuationContext(conversation);
    const run = await runGoal(request.body.goal, {
      browserSession: continuation.browserSession,
      worldState: continuation.worldState,
      keepBrowserAlive: true
    });
    const turn = recordTurn(conversation, run);

    return reply.send({
      turn,
      result: run.result,
      summary: getConversationSummary(conversation)
    });
  });

  // DELETE /conversations/:id — end a conversation
  app.delete<{ Params: { id: string } }>("/conversations/:id", async (request, reply) => {
    const conversation = conversations.get(request.params.id);
    if (!conversation) {
      return reply.code(404).send({ error: "Conversation not found" });
    }

    await endConversation(conversation);
    conversations.delete(request.params.id);
    return reply.code(204).send();
  });
}
