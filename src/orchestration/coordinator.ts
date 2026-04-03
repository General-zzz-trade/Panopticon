/**
 * Multi-Agent Coordinator — splits goals into independent sub-tasks
 * and dispatches them to parallel worker agents.
 *
 * Each worker gets its own isolated context (browser, world state).
 * The coordinator collects results and produces a unified report.
 */

export interface WorkerTask {
  id: string;
  goal: string;
  status: "pending" | "running" | "done" | "failed";
  result?: WorkerResult;
  assignedAt?: string;
  completedAt?: string;
}

export interface WorkerResult {
  success: boolean;
  summary: string;
  artifacts: string[];
  durationMs: number;
}

export interface CoordinationPlan {
  originalGoal: string;
  strategy: "parallel" | "sequential" | "single";
  workers: WorkerTask[];
  dependencies: Map<string, string[]>;  // taskId → depends on taskIds
}

export interface CoordinationReport {
  originalGoal: string;
  totalWorkers: number;
  succeeded: number;
  failed: number;
  totalDurationMs: number;
  workerResults: WorkerTask[];
  summary: string;
}

/**
 * Decompose a goal into independent worker tasks.
 * Looks for parallel-safe patterns like "test X, Y, and Z" or
 * "check A and B and C".
 */
export function planCoordination(goal: string): CoordinationPlan {
  const subGoals = extractParallelSubGoals(goal);

  if (subGoals.length <= 1) {
    return {
      originalGoal: goal,
      strategy: "single",
      workers: [{
        id: "worker-0",
        goal: goal,
        status: "pending"
      }],
      dependencies: new Map()
    };
  }

  // Check for dependencies between sub-goals
  const deps = detectDependencies(subGoals);
  const hasAnyDeps = Array.from(deps.values()).some(d => d.length > 0);

  const workers: WorkerTask[] = subGoals.map((subGoal, i) => ({
    id: `worker-${i}`,
    goal: subGoal,
    status: "pending" as const
  }));

  return {
    originalGoal: goal,
    strategy: hasAnyDeps ? "sequential" : "parallel",
    workers,
    dependencies: deps
  };
}

/**
 * Get the next batch of workers that can run (all dependencies met).
 */
export function getReadyWorkers(plan: CoordinationPlan): WorkerTask[] {
  return plan.workers.filter(worker => {
    if (worker.status !== "pending") return false;

    const deps = plan.dependencies.get(worker.id) ?? [];
    return deps.every(depId => {
      const dep = plan.workers.find(w => w.id === depId);
      return dep?.status === "done";
    });
  });
}

/**
 * Mark a worker as complete and record its result.
 */
export function completeWorker(
  plan: CoordinationPlan,
  workerId: string,
  result: WorkerResult
): void {
  const worker = plan.workers.find(w => w.id === workerId);
  if (!worker) return;

  worker.status = result.success ? "done" : "failed";
  worker.result = result;
  worker.completedAt = new Date().toISOString();
}

/**
 * Check if all workers are complete.
 */
export function isCoordinationComplete(plan: CoordinationPlan): boolean {
  return plan.workers.every(w => w.status === "done" || w.status === "failed");
}

/**
 * Generate the final coordination report.
 */
export function generateReport(plan: CoordinationPlan): CoordinationReport {
  const succeeded = plan.workers.filter(w => w.status === "done").length;
  const failed = plan.workers.filter(w => w.status === "failed").length;
  const totalDuration = plan.workers.reduce(
    (sum, w) => sum + (w.result?.durationMs ?? 0), 0
  );

  const workerSummaries = plan.workers.map(w => {
    const status = w.status === "done" ? "✓" : w.status === "failed" ? "✗" : "⏳";
    return `  ${status} ${w.id}: ${w.goal.slice(0, 80)}${w.result ? ` (${w.result.durationMs}ms)` : ""}`;
  }).join("\n");

  return {
    originalGoal: plan.originalGoal,
    totalWorkers: plan.workers.length,
    succeeded,
    failed,
    totalDurationMs: totalDuration,
    workerResults: plan.workers,
    summary: `Coordination complete: ${succeeded}/${plan.workers.length} succeeded, ${failed} failed.\n${workerSummaries}`
  };
}

// --- Internal helpers ---

function extractParallelSubGoals(goal: string): string[] {
  // Pattern 1: "test X, Y, and Z" / "check A, B, and C"
  const listMatch = goal.match(/^(test|check|verify|validate|try|run)\s+(.+)$/i);
  if (listMatch) {
    const items = listMatch[2]
      .split(/\s*(?:,\s*(?:and\s+)?|(?:\s+and\s+))\s*/i)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (items.length > 1) {
      const verb = listMatch[1];
      return items.map(item => `${verb} ${item}`);
    }
  }

  // Pattern 2: "do X in parallel with Y" / "X and Y simultaneously"
  const parallelMatch = goal.match(/(.+?)\s+(?:in parallel with|simultaneously with|at the same time as)\s+(.+)/i);
  if (parallelMatch) {
    return [parallelMatch[1].trim(), parallelMatch[2].trim()];
  }

  // Pattern 3: numbered items "1. X  2. Y  3. Z"
  const numbered = goal.match(/\d+\.\s+/g);
  if (numbered && numbered.length > 1) {
    return goal.split(/\d+\.\s+/).filter(s => s.trim().length > 0).map(s => s.trim());
  }

  return [goal];
}

function detectDependencies(subGoals: string[]): Map<string, string[]> {
  const deps = new Map<string, string[]>();

  for (let i = 0; i < subGoals.length; i++) {
    const goal = subGoals[i].toLowerCase();
    const taskDeps: string[] = [];

    // If a goal references "after", "then", or results of previous goals
    if (/after|then|using the result|based on/i.test(goal) && i > 0) {
      taskDeps.push(`worker-${i - 1}`);
    }

    deps.set(`worker-${i}`, taskDeps);
  }

  return deps;
}
