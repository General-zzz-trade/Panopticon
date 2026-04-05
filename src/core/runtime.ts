/**
 * Runtime Orchestrator — slim main loop that delegates to focused modules.
 *
 * The cognitive loop: Plan → for each task: Pipeline(observe→execute→verify→decide) → Finalize
 *
 * Split into:
 *   - run-lifecycle.ts    — init, finalize, persistence, shared helpers
 *   - task-pipeline.ts    — single-task observe→execute→verify→decide
 *   - cognitive-integrator.ts — loop detection, anomaly, meta-cognition, causal graph
 *   - recovery-pipeline.ts    — hypothesis, experiments, belief, replan
 *   - module-logger.ts        — structured logging for optional modules
 */

import type { AgentPolicy, PlannerTieBreakerPolicy, RunContext, RunLimits } from "../types";
import type { PlannerMode } from "../planner";
import {
  initializeRun,
  finalizeRun,
  validateGoal,
  getErrorMessage,
  determineTerminationReason,
  recordWorldState
} from "./run-lifecycle";
import { runTaskPipeline, type TaskPipelineContext } from "./task-pipeline";
import { tryOptional } from "./module-logger";
import { createGraphFromTasks, getReadyNodes, completeNode, isGraphComplete, getGraphSummary, type ExecutionGraph } from "./execution-graph";

export interface RunOptions {
  maxReplansPerRun?: number;
  maxReplansPerTask?: number;
  plannerMode?: PlannerMode;
  maxLLMPlannerCalls?: number;
  maxLLMReplannerCalls?: number;
  maxLLMReplannerTimeouts?: number;
  tieBreakerPolicy?: Partial<PlannerTieBreakerPolicy>;
  policy?: Partial<AgentPolicy>;
  tenantId?: string;
  /** Inject an existing browser session (for multi-turn conversations) */
  browserSession?: RunContext["browserSession"];
  /** Inject prior world state (for multi-turn conversations) */
  worldState?: RunContext["worldState"];
  /** Keep browser session alive after run (caller manages cleanup) */
  keepBrowserAlive?: boolean;
  /** Execution mode: sequential (default), htn, react (browser), desktop (GUI apps), cli (shell) */
  executionMode?: "sequential" | "htn" | "react" | "desktop" | "cli";
}

export async function runGoal(goal: string, options: RunOptions = {}): Promise<RunContext> {
  // Dispatch to alternative execution modes
  if (options.executionMode === "cli") {
    const { isCLIAgentConfigured, runCLIGoal } = await import("../computer-use/cli-agent");
    if (isCLIAgentConfigured()) {
      const result = await runCLIGoal(goal);
      const context: RunContext = {
        runId: `cli-${Date.now().toString(36)}`,
        goal,
        tasks: [],
        artifacts: [],
        replanCount: 0,
        nextTaskSequence: result.totalSteps,
        insertedTaskCount: 0,
        llmReplannerInvocations: 0,
        llmReplannerTimeoutCount: 0,
        llmReplannerFallbackCount: 0,
        escalationDecisions: [],
        limits: { maxReplansPerRun: 0, maxReplansPerTask: 0 },
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        result: { success: result.success, message: result.message },
        terminationReason: result.success ? "success" : "task_failure"
      };
      return context;
    }
  }

  if (options.executionMode === "desktop") {
    const { isDesktopAvailable, runDesktopGoal } = await import("../computer-use/desktop-agent");
    if (isDesktopAvailable()) {
      const result = await runDesktopGoal(goal);
      const context: RunContext = {
        runId: `desktop-${Date.now().toString(36)}`,
        goal,
        tasks: [],
        artifacts: [],
        replanCount: 0,
        nextTaskSequence: result.totalSteps,
        insertedTaskCount: 0,
        llmReplannerInvocations: 0,
        llmReplannerTimeoutCount: 0,
        llmReplannerFallbackCount: 0,
        escalationDecisions: [],
        limits: { maxReplansPerRun: 0, maxReplansPerTask: 0 },
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        result: { success: result.success, message: result.message },
        terminationReason: result.success ? "success" : "task_failure"
      };
      return context;
    }
    // Desktop not available — fall through
  }

  if (options.executionMode === "react") {
    const { isReactConfigured, runReactGoal } = await import("./react-loop");
    if (isReactConfigured()) {
      const result = await runReactGoal(goal, {
        tenantId: options.tenantId,
        browserSession: options.browserSession,
        keepBrowserAlive: options.keepBrowserAlive
      });
      // Convert ReactResult to RunContext for uniform interface
      const context: RunContext = {
        runId: result.runId,
        goal,
        tasks: [],
        artifacts: [],
        replanCount: 0,
        nextTaskSequence: result.totalSteps,
        insertedTaskCount: 0,
        llmReplannerInvocations: 0,
        llmReplannerTimeoutCount: 0,
        llmReplannerFallbackCount: 0,
        escalationDecisions: [],
        limits: { maxReplansPerRun: 0, maxReplansPerTask: 0 },
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        result: { success: result.success, message: result.message },
        terminationReason: result.success ? "success" : "task_failure"
      };
      return context;
    }
    // ReAct not configured — fall through to sequential
  }

  if (options.executionMode === "htn") {
    try {
      const { runGoalHTN } = await import("./htn-runtime");
      const htnResult = await runGoalHTN(goal, { ...options, maxDepth: 3 });
      if (htnResult.lastContext) return htnResult.lastContext;
    } catch {
      // HTN failed — fall through to sequential execution
    }
  }

  const state = await initializeRun(goal, options);
  const { context } = state;

  if (context.worldState) {
    recordWorldState(context, context.worldState, "state_update", "run_initialized");
  }

  const pipeline: TaskPipelineContext = {
    options,
    summaries: state.summaries,
    causalGraph: state.causalGraph,
    onlineAdapter: state.onlineAdapter,
    stateEmbeddingHistory: state.stateEmbeddingHistory,
    consecutiveLoopDetections: { value: state.consecutiveLoopDetections },
    tokenBudget: state.tokenBudget,
    workingMemory: state.workingMemory,
    reasoningTrace: state.reasoningTrace
  };

  try {
    // Auto-escalate to ReAct: if planners produced no tasks for an NL goal, try ReAct
    if (context.tasks.length === 0) {
      const { isNaturalLanguageGoal } = await import("../planner/nl-planner");
      const { isReactConfigured, runReactGoal } = await import("./react-loop");
      if (isNaturalLanguageGoal(goal) && isReactConfigured()) {
        console.warn("[runtime] No tasks planned for NL goal — auto-escalating to ReAct mode");
        const reactResult = await runReactGoal(goal, {
          tenantId: options.tenantId,
          browserSession: context.browserSession,
          keepBrowserAlive: options.keepBrowserAlive
        });
        context.result = { success: reactResult.success, message: reactResult.message };
        context.terminationReason = reactResult.success ? "success" : "task_failure";
        await finalizeRun(state, options);
        return context;
      }
    }

    validateGoal(goal, context.tasks);

    // Build execution graph from task list
    const graph = createGraphFromTasks(context.tasks);

    // DAG-aware execution: process ready nodes until graph is complete
    while (!isGraphComplete(graph)) {
      const readyNodes = getReadyNodes(graph);
      if (readyNodes.length === 0) break; // No progress possible

      // Execute ready nodes (sequentially for now; parallel support via orchestrator)
      for (const node of readyNodes) {
        if (node.type !== "task") {
          // Fork/join/decision nodes auto-complete
          completeNode(graph, node.id, true, `${node.type} node passed`);
          continue;
        }

        const taskIndex = context.tasks.findIndex(t => t.id === node.taskId);
        if (taskIndex < 0) {
          completeNode(graph, node.id, false, "Task not found in context");
          continue;
        }

        const result = await runTaskPipeline(context, taskIndex, pipeline);

        if (result.outcome === "abort" || result.nextIndex === null) {
          completeNode(graph, node.id, false, "Task aborted");
          // Abort terminates the run — break out of both loops
          throw new Error(context.tasks[taskIndex].error ?? "Task aborted");
        }

        const task = context.tasks[taskIndex];
        const success = task.status === "done";
        completeNode(graph, node.id, success, success ? `Completed: ${task.type}` : `Failed: ${task.error ?? "unknown"}`);

        // If replan inserted new tasks, rebuild graph edges
        if (result.outcome === "replan" && result.nextIndex !== null) {
          // New tasks were inserted — continue with linear fallback for the rest
          let fallbackIndex = result.nextIndex;
          while (fallbackIndex < context.tasks.length) {
            const fbResult = await runTaskPipeline(context, fallbackIndex, pipeline);
            if (fbResult.outcome === "abort" || fbResult.nextIndex === null) break;
            fallbackIndex = fbResult.nextIndex;
          }
          // Mark remaining graph nodes based on task statuses
          for (const [nodeId, gNode] of graph.nodes) {
            if (gNode.status === "pending") {
              const t = context.tasks.find(t2 => t2.id === gNode.taskId);
              if (t?.status === "done") completeNode(graph, nodeId, true, "Completed via fallback");
              else if (t?.status === "failed") completeNode(graph, nodeId, false, t.error ?? "Failed");
            }
          }
          break;
        }
      }
    }

    const summary = getGraphSummary(graph);
    context.result = {
      success: summary.failed === 0,
      message: `Goal: ${goal}\n${state.summaries.join("\n")}`
    };
    context.terminationReason = summary.failed === 0 ? "success" : "task_failure";
    tryOptional("checkpoint", () => {
      const { clearCheckpoint } = require("./checkpoint");
      clearCheckpoint(context.runId);
    }, "clearing checkpoint");
  } catch (error) {
    const message = getErrorMessage(error);

    // Auto-escalate to ReAct on failure: if sequential failed for an NL goal, try ReAct
    if (!options.executionMode || options.executionMode === "sequential") {
      try {
        const { isNaturalLanguageGoal } = await import("../planner/nl-planner");
        const { isReactConfigured, runReactGoal } = await import("./react-loop");
        if (isNaturalLanguageGoal(goal) && isReactConfigured()) {
          console.warn("[runtime] Sequential execution failed for NL goal — auto-escalating to ReAct");
          const reactResult = await runReactGoal(goal, {
            tenantId: options.tenantId,
            browserSession: context.browserSession,
            keepBrowserAlive: options.keepBrowserAlive
          });
          context.result = { success: reactResult.success, message: reactResult.message };
          context.terminationReason = reactResult.success ? "success" : "task_failure";
          // Don't throw — let finally run, then return context
          await finalizeRun(state, options);
          return context;
        }
      } catch {
        // ReAct escalation failed — fall through to normal error handling
      }
    }

    context.result = {
      success: false,
      message: `Task failed: ${message}`,
      error: message
    };
    context.terminationReason = determineTerminationReason(message);
  } finally {
    await finalizeRun(state, options);
  }

  return context;
}
