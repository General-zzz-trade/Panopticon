import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { createSchedule, getSchedule, listSchedules, deleteSchedule, setScheduleEnabled } from "../../scheduler/store";
import { validateCronExpr, nextCronDate } from "../../scheduler/cron-parser";
import { sanitizeGoal } from "../sanitize";

export async function schedulesRoutes(app: FastifyInstance): Promise<void> {
  // POST /schedules — create a new schedule
  app.post<{ Body: { name: string; goal: string; cronExpr: string } }>(
    "/schedules",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "goal", "cronExpr"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            goal: { type: "string", minLength: 1, maxLength: 2000 },
            cronExpr: { type: "string", minLength: 1, maxLength: 100 }
          }
        }
      }
    },
    async (request, reply) => {
      const { name, goal: rawGoal, cronExpr } = request.body;
      const goal = sanitizeGoal(rawGoal);
      if (!goal) return reply.code(400).send({ error: "goal is empty after sanitization" });

      const validation = validateCronExpr(cronExpr);
      if (!validation.valid) return reply.code(400).send({ error: `Invalid cron: ${validation.error}` });

      const id = randomBytes(8).toString("hex");
      const nextRunAt = nextCronDate(cronExpr).toISOString();
      const record = createSchedule({ id, name, goal, cronExpr, tenantId: request.tenantId, enabled: true, nextRunAt });
      return reply.code(201).send(record);
    }
  );

  // GET /schedules — list schedules
  app.get("/schedules", async (request, reply) => {
    return reply.send({ schedules: listSchedules(request.tenantId) });
  });

  // GET /schedules/:id
  app.get<{ Params: { id: string } }>("/schedules/:id", async (request, reply) => {
    const s = getSchedule(request.params.id);
    if (!s || s.tenantId !== request.tenantId) return reply.code(404).send({ error: "Schedule not found" });
    return reply.send(s);
  });

  // PATCH /schedules/:id/enable and /disable
  app.patch<{ Params: { id: string } }>("/schedules/:id/enable", async (request, reply) => {
    const s = getSchedule(request.params.id);
    if (!s || s.tenantId !== request.tenantId) return reply.code(404).send({ error: "Not found" });
    setScheduleEnabled(request.params.id, true);
    return reply.send({ id: request.params.id, enabled: true });
  });

  app.patch<{ Params: { id: string } }>("/schedules/:id/disable", async (request, reply) => {
    const s = getSchedule(request.params.id);
    if (!s || s.tenantId !== request.tenantId) return reply.code(404).send({ error: "Not found" });
    setScheduleEnabled(request.params.id, false);
    return reply.send({ id: request.params.id, enabled: false });
  });

  // DELETE /schedules/:id
  app.delete<{ Params: { id: string } }>("/schedules/:id", async (request, reply) => {
    const s = getSchedule(request.params.id);
    if (!s || s.tenantId !== request.tenantId) return reply.code(404).send({ error: "Not found" });
    deleteSchedule(request.params.id);
    return reply.code(204).send();
  });
}
