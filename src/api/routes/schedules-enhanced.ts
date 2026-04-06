import type { FastifyInstance } from "fastify";
import { getSchedule, listSchedules, setScheduleEnabled, updateScheduleRun } from "../../scheduler/store";
import { nextCronDate } from "../../scheduler/cron-parser";
import { submitJob } from "../../worker/pool";
import { sanitizeGoal } from "../sanitize";

/* ------------------------------------------------------------------ */
/*  Enhanced Schedule Routes                                           */
/* ------------------------------------------------------------------ */

/* ---- In-memory execution history ---- */

interface ScheduleExecution {
  scheduleId: string;
  runId: string;
  startedAt: string;
  success: boolean | null; // null = still running
}

const executionHistory: ScheduleExecution[] = [];

/** Max history entries retained in memory */
const MAX_HISTORY = 500;

function recordExecution(entry: ScheduleExecution): void {
  executionHistory.unshift(entry);
  if (executionHistory.length > MAX_HISTORY) {
    executionHistory.length = MAX_HISTORY;
  }
}

/* ---- In-memory pause state (overlay on DB enabled flag) ---- */

const pausedSchedules = new Set<string>();

/* ---- Public helpers for other modules to report run outcomes ---- */

export function reportScheduleRunComplete(runId: string, success: boolean): void {
  const entry = executionHistory.find((e) => e.runId === runId);
  if (entry) {
    entry.success = success;
  }
}

/* ---- Routes ---- */

export async function schedulesEnhancedRoutes(app: FastifyInstance): Promise<void> {
  // GET /schedules/history — list recent schedule executions
  app.get<{ Querystring: { scheduleId?: string; limit?: string; offset?: string } }>(
    "/schedules/history",
    async (request, reply) => {
      const tenantId = request.tenantId ?? "default";
      const limit = Math.min(Number(request.query.limit ?? 50), 200);
      const offset = Number(request.query.offset ?? 0);
      const { scheduleId } = request.query;

      // Filter by tenant: we need to resolve scheduleIds that belong to this tenant
      const tenantSchedules = new Set(listSchedules(tenantId).map((s) => s.id));

      let history = executionHistory.filter((e) => tenantSchedules.has(e.scheduleId));
      if (scheduleId) {
        history = history.filter((e) => e.scheduleId === scheduleId);
      }

      const page = history.slice(offset, offset + limit);
      return reply.send({
        executions: page,
        total: history.length,
        limit,
        offset,
      });
    }
  );

  // POST /schedules/:id/pause — pause a schedule
  app.post<{ Params: { id: string } }>("/schedules/:id/pause", async (request, reply) => {
    const tenantId = request.tenantId ?? "default";
    const s = getSchedule(request.params.id);
    if (!s || s.tenantId !== tenantId) {
      return reply.code(404).send({ error: "Schedule not found" });
    }
    pausedSchedules.add(s.id);
    setScheduleEnabled(s.id, false);
    return reply.send({
      id: s.id,
      name: s.name,
      enabled: false,
      paused: true,
      lastRunAt: s.lastRunAt ?? null,
      runCount: s.runCount,
      nextRunAt: null,
    });
  });

  // POST /schedules/:id/resume — resume a schedule
  app.post<{ Params: { id: string } }>("/schedules/:id/resume", async (request, reply) => {
    const tenantId = request.tenantId ?? "default";
    const s = getSchedule(request.params.id);
    if (!s || s.tenantId !== tenantId) {
      return reply.code(404).send({ error: "Schedule not found" });
    }
    pausedSchedules.delete(s.id);
    setScheduleEnabled(s.id, true);
    const nextRun = nextCronDate(s.cronExpr).toISOString();
    return reply.send({
      id: s.id,
      name: s.name,
      enabled: true,
      paused: false,
      lastRunAt: s.lastRunAt ?? null,
      runCount: s.runCount,
      nextRunAt: nextRun,
    });
  });

  // POST /schedules/:id/run-now — trigger immediate execution
  app.post<{ Params: { id: string } }>("/schedules/:id/run-now", async (request, reply) => {
    const tenantId = request.tenantId ?? "default";
    const s = getSchedule(request.params.id);
    if (!s || s.tenantId !== tenantId) {
      return reply.code(404).send({ error: "Schedule not found" });
    }

    const goal = sanitizeGoal(s.goal);
    if (!goal) return reply.code(400).send({ error: "Schedule goal is empty after sanitization" });

    const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    // Submit the job
    submitJob(runId, goal, {}, tenantId);

    // Record execution
    recordExecution({
      scheduleId: s.id,
      runId,
      startedAt: now,
      success: null,
    });

    // Update schedule run tracking
    const nextRun = nextCronDate(s.cronExpr).toISOString();
    updateScheduleRun(s.id, now, nextRun);

    // Re-fetch for latest counts
    const updated = getSchedule(s.id);

    return reply.code(202).send({
      runId,
      scheduleId: s.id,
      status: "pending",
      triggeredAt: now,
      lastRunAt: updated?.lastRunAt ?? now,
      lastRunSuccess: null,
      runCount: updated?.runCount ?? s.runCount + 1,
      nextRunAt: nextRun,
    });
  });

  // GET /schedules/:id/stats — get enhanced stats for a schedule
  app.get<{ Params: { id: string } }>("/schedules/:id/stats", async (request, reply) => {
    const tenantId = request.tenantId ?? "default";
    const s = getSchedule(request.params.id);
    if (!s || s.tenantId !== tenantId) {
      return reply.code(404).send({ error: "Schedule not found" });
    }

    const history = executionHistory.filter((e) => e.scheduleId === s.id);
    const successCount = history.filter((e) => e.success === true).length;
    const failCount = history.filter((e) => e.success === false).length;
    const lastRun = history.length > 0 ? history[0] : null;

    return reply.send({
      id: s.id,
      name: s.name,
      enabled: s.enabled,
      paused: pausedSchedules.has(s.id),
      lastRunAt: s.lastRunAt ?? null,
      lastRunSuccess: lastRun?.success ?? null,
      runCount: s.runCount,
      nextRunAt: s.enabled ? s.nextRunAt ?? null : null,
      recentHistory: {
        total: history.length,
        successes: successCount,
        failures: failCount,
      },
    });
  });
}
