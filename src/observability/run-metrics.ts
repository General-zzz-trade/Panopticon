import { RunContext, RunMetrics } from "../types";

export function calculateRunMetrics(run: RunContext): RunMetrics {
  const totalTasks = run.tasks.length;
  const doneTasks = run.tasks.filter((task) => task.status === "done").length;
  const failedTasks = run.tasks.filter((task) => task.status === "failed").length;
  const totalRetries = run.tasks.reduce((sum, task) => sum + task.retries, 0);
  const totalReplans = run.replanCount;

  const durations = run.tasks
    .map((task) => task.durationMs)
    .filter((duration): duration is number => typeof duration === "number");

  const averageTaskDurationMs =
    durations.length > 0
      ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
      : 0;

  return {
    totalTasks,
    doneTasks,
    failedTasks,
    totalRetries,
    totalReplans,
    averageTaskDurationMs
  };
}
