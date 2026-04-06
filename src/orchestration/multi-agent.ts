/**
 * Multi-Agent Orchestration — manages pools of specialized agent instances
 * (planner, executor, verifier, critic, researcher) that collaborate on a
 * shared goal through a structured orchestration loop.
 */

import { randomUUID } from "node:crypto";
import {
  planCoordination,
  getReadyWorkers,
  completeWorker,
  isCoordinationComplete,
  generateReport,
  type WorkerResult,
  type CoordinationPlan,
} from "./coordinator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRole = "planner" | "executor" | "verifier" | "critic" | "researcher";

export type AgentStatus = "idle" | "working" | "done" | "failed";

export interface AgentInstance {
  id: string;
  role: AgentRole;
  status: AgentStatus;
  currentTask: string | null;
  results: AgentResult[];
}

export interface AgentResult {
  taskId: string;
  output: string;
  success: boolean;
  durationMs: number;
  timestamp: string;
}

export interface MultiAgentSession {
  id: string;
  goal: string;
  agents: AgentInstance[];
  status: "created" | "running" | "completed" | "failed";
  plan: CoordinationPlan | null;
  improvements: string[];
  createdAt: string;
  completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Session store (in-memory)
// ---------------------------------------------------------------------------

const sessions = new Map<string, MultiAgentSession>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a multi-agent session with the given goal and role assignments.
 * At least a 'planner' and one 'executor' role should be provided.
 */
export function createMultiAgentSession(
  goal: string,
  roles: AgentRole[]
): MultiAgentSession {
  const id = `mas-${randomUUID()}`;

  const agents: AgentInstance[] = roles.map((role, idx) => ({
    id: `agent-${role}-${idx}`,
    role,
    status: "idle" as const,
    currentTask: null,
    results: [],
  }));

  const session: MultiAgentSession = {
    id,
    goal,
    agents,
    status: "created",
    plan: null,
    improvements: [],
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  sessions.set(id, session);
  return session;
}

/**
 * Run the multi-agent orchestration loop:
 *   1. Planner agent decomposes the goal
 *   2. Executor agents run tasks in parallel batches
 *   3. Verifier agent checks results
 *   4. Critic agent reviews and suggests improvements
 */
export async function runMultiAgent(session: MultiAgentSession): Promise<MultiAgentSession> {
  session.status = "running";

  try {
    // --- Phase 1: Planning ---
    const plannerAgent = session.agents.find((a) => a.role === "planner");
    if (plannerAgent) {
      plannerAgent.status = "working";
      plannerAgent.currentTask = "decompose_goal";

      const startPlan = Date.now();
      session.plan = planCoordination(session.goal);
      const planDuration = Date.now() - startPlan;

      plannerAgent.results.push({
        taskId: "decompose_goal",
        output: `Decomposed goal into ${session.plan.workers.length} tasks (strategy: ${session.plan.strategy})`,
        success: true,
        durationMs: planDuration,
        timestamp: new Date().toISOString(),
      });
      plannerAgent.status = "done";
      plannerAgent.currentTask = null;
    } else {
      // No planner — create a single-task plan
      session.plan = planCoordination(session.goal);
    }

    // --- Phase 2: Execution ---
    const executors = session.agents.filter((a) => a.role === "executor");
    if (executors.length === 0) {
      // Treat the whole session as a single executor if none specified
      executors.push(session.agents[0] ?? createFallbackAgent("executor"));
    }

    while (!isCoordinationComplete(session.plan)) {
      const readyWorkers = getReadyWorkers(session.plan);
      if (readyWorkers.length === 0) break;

      const batch = readyWorkers.map((worker, i) => {
        const executor = executors[i % executors.length];
        executor.status = "working";
        executor.currentTask = worker.id;

        return executeTask(worker.id, worker.goal).then((result) => {
          completeWorker(session.plan!, worker.id, result);

          executor.results.push({
            taskId: worker.id,
            output: result.summary,
            success: result.success,
            durationMs: result.durationMs,
            timestamp: new Date().toISOString(),
          });
          executor.currentTask = null;
          return result;
        });
      });

      await Promise.all(batch);
    }

    for (const e of executors) {
      e.status = "done";
    }

    // --- Phase 3: Verification ---
    const verifierAgent = session.agents.find((a) => a.role === "verifier");
    if (verifierAgent && session.plan) {
      verifierAgent.status = "working";
      verifierAgent.currentTask = "verify_results";
      const startVerify = Date.now();

      const report = generateReport(session.plan);
      const allPassed = report.failed === 0;

      verifierAgent.results.push({
        taskId: "verify_results",
        output: `Verification: ${report.succeeded}/${report.totalWorkers} tasks passed`,
        success: allPassed,
        durationMs: Date.now() - startVerify,
        timestamp: new Date().toISOString(),
      });
      verifierAgent.status = "done";
      verifierAgent.currentTask = null;
    }

    // --- Phase 4: Critique ---
    const criticAgent = session.agents.find((a) => a.role === "critic");
    if (criticAgent && session.plan) {
      criticAgent.status = "working";
      criticAgent.currentTask = "review_results";
      const startCritic = Date.now();

      const failedTasks = session.plan.workers.filter((w) => w.status === "failed");
      const improvements: string[] = [];

      if (failedTasks.length > 0) {
        improvements.push(
          `${failedTasks.length} task(s) failed — consider retrying with alternative approaches`
        );
        for (const ft of failedTasks) {
          improvements.push(`Task "${ft.goal.slice(0, 60)}" failed: review error handling`);
        }
      }

      if (session.plan.workers.length === 1) {
        improvements.push("Single-task plan — consider decomposing into smaller steps for better parallelism");
      }

      if (improvements.length === 0) {
        improvements.push("All tasks completed successfully — no improvements needed");
      }

      session.improvements = improvements;

      criticAgent.results.push({
        taskId: "review_results",
        output: improvements.join("; "),
        success: true,
        durationMs: Date.now() - startCritic,
        timestamp: new Date().toISOString(),
      });
      criticAgent.status = "done";
      criticAgent.currentTask = null;
    }

    // --- Phase 5: Research (optional) ---
    const researcherAgent = session.agents.find((a) => a.role === "researcher");
    if (researcherAgent) {
      researcherAgent.status = "working";
      researcherAgent.currentTask = "gather_context";
      const startResearch = Date.now();

      researcherAgent.results.push({
        taskId: "gather_context",
        output: `Gathered context for goal: "${session.goal.slice(0, 80)}"`,
        success: true,
        durationMs: Date.now() - startResearch,
        timestamp: new Date().toISOString(),
      });
      researcherAgent.status = "done";
      researcherAgent.currentTask = null;
    }

    session.status = "completed";
    session.completedAt = new Date().toISOString();
  } catch (err) {
    session.status = "failed";
    session.completedAt = new Date().toISOString();
  }

  return session;
}

/**
 * Get the current status of a multi-agent session.
 */
export function getSessionStatus(sessionId: string): MultiAgentSession | null {
  return sessions.get(sessionId) ?? null;
}

/**
 * List all sessions.
 */
export function listSessions(): MultiAgentSession[] {
  return Array.from(sessions.values());
}

/**
 * Delete a session.
 */
export function deleteSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function executeTask(taskId: string, goal: string): Promise<WorkerResult> {
  const start = Date.now();
  // Simulate task execution — in production this would dispatch to the runtime
  await new Promise((r) => setTimeout(r, 1));

  return {
    success: true,
    summary: `Executed: ${goal.slice(0, 120)}`,
    artifacts: [],
    durationMs: Date.now() - start,
  };
}

function createFallbackAgent(role: AgentRole): AgentInstance {
  return {
    id: `agent-${role}-fallback`,
    role,
    status: "idle",
    currentTask: null,
    results: [],
  };
}
