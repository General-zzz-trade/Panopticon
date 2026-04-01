import { listSchedules, updateScheduleRun } from "./store";
import { nextCronDate } from "./cron-parser";
import { submitJob } from "../worker/pool";

let _timer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (_timer) return;
  // Fire immediately to catch any overdue schedules, then every 60s
  void tickScheduler();
  _timer = setInterval(() => void tickScheduler(), 60_000);
}

export function stopScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

export async function tickScheduler(): Promise<number> {
  const now = new Date();
  const due = listSchedules().filter(s => {
    if (!s.enabled) return false;
    if (!s.nextRunAt) return true; // never run — fire now
    return new Date(s.nextRunAt) <= now;
  });

  for (const schedule of due) {
    const runId = `sched-${schedule.id}-${Date.now()}`;
    submitJob(runId, schedule.goal, {}, schedule.tenantId);
    const nextRun = nextCronDate(schedule.cronExpr, now);
    updateScheduleRun(schedule.id, now.toISOString(), nextRun.toISOString());
  }

  return due.length;
}
