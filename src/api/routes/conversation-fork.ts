/**
 * Conversation Fork routes — branch conversations from a specific turn.
 */

import type { FastifyInstance } from "fastify";
import { forkConversation, listForks } from "../../session/conversation-fork";

export async function conversationForkRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /conversations/:id/fork — fork a conversation from a given turn
   */
  app.post<{
    Params: { id: string };
    Body: { fromTurnIndex: number };
  }>(
    "/conversations/:id/fork",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["fromTurnIndex"],
          properties: {
            fromTurnIndex: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { fromTurnIndex } = request.body;

      try {
        const result = forkConversation(id, fromTurnIndex);
        return reply.code(201).send({
          newId: result.newId,
          turns: result.turns,
          forkedFrom: id,
          fromTurnIndex,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    }
  );

  /**
   * GET /conversations/:id/forks — list forks of a conversation
   */
  app.get<{
    Params: { id: string };
  }>(
    "/conversations/:id/forks",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const forks = listForks(id);
      return reply.send({ conversationId: id, forks });
    }
  );
}
