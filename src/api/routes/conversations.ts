import type { FastifyInstance } from "fastify";
import {
  createConversation,
  endConversation,
  getConversationSummary,
  getConversation,
  listConversations,
  deleteConversation
} from "../../session/conversation";

export async function conversationsRoutes(app: FastifyInstance): Promise<void> {
  // POST /conversations — create a new conversation session
  app.post("/conversations", async (_request, reply) => {
    const conversation = createConversation();
    return reply.code(201).send({
      id: conversation.id,
      createdAt: conversation.createdAt
    });
  });

  // GET /conversations — list active conversations
  app.get("/conversations", async (_request, reply) => {
    const list = listConversations().map(c => ({
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
    const conversation = getConversation(request.params.id);
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

  // DELETE /conversations/:id — end a conversation
  app.delete<{ Params: { id: string } }>("/conversations/:id", async (request, reply) => {
    const conversation = getConversation(request.params.id);
    if (!conversation) {
      return reply.code(404).send({ error: "Conversation not found" });
    }
    await endConversation(conversation);
    deleteConversation(request.params.id);
    return reply.code(204).send();
  });
}
