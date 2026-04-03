/**
 * Parallel task runner — executes independent tasks concurrently.
 *
 * Tasks with no `dependsOn` (or whose dependencies are all done)
 * are eligible to run. Multiple eligible tasks execute in parallel via
 * Promise.all. This replaces the sequential while-loop for runs that
 * have parallel-capable task graphs.
 *
 * Falls back to sequential execution when tasks have no dependency info.
 */

import { executeTask } from "./executor";
import type { AgentTask, RunContext } from "../types";
import type { TaskExecutionOutput } from "../handlers/browser-handler";

export async function runTasksWithDependencies(
  context: RunContext,
  onSummary: (s: string) => void
): Promise<void> {
  const hasDeps = context.tasks.some(t => t.dependsOn && t.dependsOn.length > 0);

  if (!hasDeps) {
    // Sequential fallback — preserves exact original behaviour
    await runSequential(context, onSummary);
    return;
  }

  await runParallel(context, onSummary);
}

async function runSequential(context: RunContext, onSummary: (s: string) => void): Promise<void> {
  for (const task of context.tasks) {
    const output = await executeTask(context, task);
    onSummary(output.summary);
    if (output.artifacts) context.artifacts.push(...output.artifacts);
  }
}

async function runParallel(context: RunContext, onSummary: (s: string) => void): Promise<void> {
  const completed = new Set<string>();
  const failed = new Set<string>();
  const inFlight = new Map<string, Promise<void>>();

  const isReady = (task: AgentTask): boolean => {
    if (task.status !== "pending") return false;
    if (!task.dependsOn || task.dependsOn.length === 0) return true;
    return task.dependsOn.every(dep => completed.has(dep));
  };

  const runTask = async (task: AgentTask): Promise<void> => {
    try {
      const output = await executeTask(context, task);
      onSummary(output.summary);
      if (output.artifacts) context.artifacts.push(...output.artifacts);
      completed.add(task.id);
    } catch (err) {
      failed.add(task.id);
      // Mark all downstream tasks as failed too
      markDownstream(context.tasks, task.id, failed);
      throw err;
    } finally {
      inFlight.delete(task.id);
    }
  };

  // Drain loop: keep launching ready tasks until all done or error
  while (true) {
    const pending = context.tasks.filter(t => t.status === "pending" && !failed.has(t.id));
    if (pending.length === 0 && inFlight.size === 0) break;

    const ready = pending.filter(isReady).filter(t => !inFlight.has(t.id));

    if (ready.length === 0 && inFlight.size === 0) {
      // Deadlock or all remaining tasks blocked by failed deps
      const blocked = pending.filter(t => !isReady(t));
      if (blocked.length > 0) {
        throw new Error(
          `Parallel runner: ${blocked.length} task(s) blocked by failed dependencies: ` +
          blocked.map(t => t.id).join(", ")
        );
      }
      break;
    }

    for (const task of ready) {
      const p = runTask(task);
      inFlight.set(task.id, p);
    }

    if (inFlight.size > 0) {
      // Wait for at least one to finish before re-checking
      await Promise.race([...inFlight.values()]).catch(() => {});
    }
  }

  // If any failed, throw to trigger normal error handling
  if (failed.size > 0) {
    const firstFailed = context.tasks.find(t => failed.has(t.id) && t.error);
    throw new Error(firstFailed?.error ?? "One or more parallel tasks failed");
  }
}

function markDownstream(tasks: AgentTask[], failedId: string, failed: Set<string>): void {
  for (const task of tasks) {
    if (task.dependsOn?.includes(failedId) && !failed.has(task.id)) {
      failed.add(task.id);
      markDownstream(tasks, task.id, failed);
    }
  }
}
