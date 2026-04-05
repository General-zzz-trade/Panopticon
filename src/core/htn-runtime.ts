/**
 * HTN Runtime — Hierarchical Task Network execution mode.
 *
 * Wraps the existing `runGoal()` with lazy hierarchical decomposition:
 * try executing the goal as-is first; on failure, decompose into sub-goals
 * via LLM (or simple text splitting) and recurse. Supports backtracking
 * when sub-goals fail after decomposition.
 *
 * Max decomposition depth: 3 levels.
 */

import { runGoal, RunOptions } from "./runtime";
import type { RunContext } from "../types";
import type { HTNGoalNode, HTNPlan } from "../cognition/types";
import {
  createHTNPlan,
  decomposeNode,
  markNodeDone,
  markNodeFailed,
  isPlanComplete,
  isPlanFailed,
  getPlanSummary
} from "../decomposer/htn-planner";
import {
  readProviderConfig,
  callOpenAICompatible,
  callAnthropic,
  safeJsonParse
} from "../llm/provider";
import { logModuleError } from "./module-logger";

// ── Public types ────────────────────────────────────────────────────────────

export interface HTNRunOptions extends RunOptions {
  /** Maximum decomposition depth (default 3). */
  maxDepth?: number;
  /** Skip LLM decomposition and use simple text splitting only. */
  noLLMDecompose?: boolean;
}

export interface HTNRunResult {
  success: boolean;
  plan: HTNPlan;
  /** Last RunContext produced (from the final executed sub-goal). */
  lastContext: RunContext | null;
  /** All RunContexts collected during execution, keyed by node ID. */
  contexts: Map<string, RunContext>;
  error?: string;
}

// ── LLM-based goal decomposition ────────────────────────────────────────────

const DECOMPOSE_SYSTEM_PROMPT = `You are a task decomposition assistant. Given a high-level goal, split it into 2-5 sequential sub-goals that together achieve the original goal. Each sub-goal should be a self-contained action.

Respond with a JSON array of strings, nothing else. Example:
["Open the settings page", "Find the notification toggle", "Disable notifications"]`;

/**
 * Call the LLM to decompose a goal into 2-5 sub-goals.
 * Falls back to simple text splitting if LLM is not configured or the call fails.
 */
export async function decomposeGoalLLM(goal: string): Promise<string[]> {
  try {
    const config = readProviderConfig("LLM_PLANNER");
    if (!config.apiKey) {
      return decomposeGoalSimple(goal);
    }

    const messages = [
      { role: "system" as const, content: DECOMPOSE_SYSTEM_PROMPT },
      { role: "user" as const, content: `Decompose this goal into sub-goals:\n\n${goal}` }
    ];

    let result;
    if (config.provider === "anthropic") {
      result = await callAnthropic(config, messages);
    } else {
      result = await callOpenAICompatible(config, messages);
    }

    const parsed = safeJsonParse(result.content);
    if (Array.isArray(parsed) && parsed.length >= 2 && parsed.length <= 5) {
      return parsed.map(String);
    }

    // Try to extract a JSON array from the response text
    const match = result.content.match(/\[[\s\S]*\]/);
    if (match) {
      const arr = safeJsonParse(match[0]);
      if (Array.isArray(arr) && arr.length >= 2 && arr.length <= 5) {
        return arr.map(String);
      }
    }

    return decomposeGoalSimple(goal);
  } catch (error) {
    logModuleError("htn-runtime", "optional", error, "LLM goal decomposition");
    return decomposeGoalSimple(goal);
  }
}

/**
 * Simple text-based decomposition: splits on common conjunctions and delimiters.
 * Always returns at least 2 parts; if splitting fails, wraps the goal in a
 * two-step "navigate + act" pattern.
 */
export function decomposeGoalSimple(goal: string): string[] {
  // Try splitting on common delimiters
  const delimiters = [" and then ", ", then ", " then ", "; ", " and "];
  for (const delim of delimiters) {
    if (goal.toLowerCase().includes(delim)) {
      const parts = goal.split(new RegExp(delim, "i"))
        .map(s => s.trim())
        .filter(s => s.length > 0);
      if (parts.length >= 2) return parts.slice(0, 5);
    }
  }

  // Fallback: break into "find/navigate" + "perform action"
  return [
    `Navigate to the relevant page for: ${goal}`,
    `Perform the action: ${goal}`
  ];
}

// ── HTN execution engine ────────────────────────────────────────────────────

/**
 * Execute a goal using HTN-style lazy decomposition.
 *
 * Strategy:
 * 1. Try executing the goal directly via `runGoal()`.
 * 2. If it fails and depth < maxDepth, decompose into sub-goals.
 * 3. Recursively attempt each sub-goal.
 * 4. If a sub-goal fails after decomposition, backtrack to parent.
 */
export async function runGoalHTN(
  goal: string,
  options: HTNRunOptions = {}
): Promise<HTNRunResult> {
  const maxDepth = options.maxDepth ?? 3;
  const plan = createHTNPlan(goal);
  const contexts = new Map<string, RunContext>();

  const result = await executeHTNNode(plan, plan.rootId, options, maxDepth, contexts);

  const summary = getPlanSummary(plan);
  const success = isPlanComplete(plan);

  return {
    success,
    plan,
    lastContext: result,
    contexts,
    error: success ? undefined : `HTN plan failed. ${summary.failed} of ${summary.totalNodes} nodes failed.`
  };
}

/**
 * Recursively execute an HTN node. Returns the RunContext on success, or null on failure.
 */
async function executeHTNNode(
  plan: HTNPlan,
  nodeId: string,
  options: HTNRunOptions,
  maxDepth: number,
  contexts: Map<string, RunContext>
): Promise<RunContext | null> {
  const node = plan.nodes.get(nodeId);
  if (!node) return null;

  node.status = "active";

  // Step 1: Try executing the goal directly
  try {
    const ctx = await runGoal(node.goal, options);
    contexts.set(nodeId, ctx);

    // Check if the run was successful (no tasks failed)
    const allTasksOk = ctx.tasks.every(
      t => t.status === "done" || (t.status as string) === "skipped"
    );

    if (allTasksOk) {
      markNodeDone(plan, nodeId);
      return ctx;
    }
  } catch (error) {
    logModuleError("htn-runtime", "optional", error, "direct goal execution before decomposition");
  }

  // Step 2: If depth limit reached, mark as failed
  if (node.depth >= maxDepth) {
    markNodeFailed(plan, nodeId, `Depth limit (${maxDepth}) reached`);
    return null;
  }

  // Step 3: Decompose into sub-goals
  const subGoals = options.noLLMDecompose
    ? decomposeGoalSimple(node.goal)
    : await decomposeGoalLLM(node.goal);

  const childIds = decomposeNode(plan, nodeId, subGoals);
  if (childIds.length === 0) {
    markNodeFailed(plan, nodeId, "Decomposition exhausted");
    return null;
  }

  // Step 4: Execute children sequentially
  let lastCtx: RunContext | null = null;
  for (const childId of childIds) {
    const childCtx = await executeHTNNode(plan, childId, options, maxDepth, contexts);

    if (childCtx) {
      lastCtx = childCtx;
    } else {
      // Child failed — backtracking is handled by markNodeFailed in the recursive call.
      // Check if the parent (this node) was reset for re-decomposition.
      const current = plan.nodes.get(nodeId);
      if (current && current.status === "pending") {
        // Node was reset by backtracking — retry decomposition
        return executeHTNNode(plan, nodeId, options, maxDepth, contexts);
      }
      // Otherwise propagate failure
      if (!isPlanFailed(plan)) {
        markNodeFailed(plan, nodeId, `Sub-goal failed: ${subGoals[childIds.indexOf(childId)]}`);
      }
      return null;
    }
  }

  // All children succeeded — parent is marked done via propagation in markNodeDone
  return lastCtx;
}
