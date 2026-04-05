/**
 * Causal Goal Decomposer — uses the causal graph to decompose goals
 * into sub-goals based on precondition chains.
 *
 * Given a goal state, it finds what preconditions must be met and
 * generates sub-goals to achieve them.
 */

import { logModuleError } from "../core/module-logger";
import type { CausalGraph, CausalEdge } from "../world-model/causal-graph";
import { findPath, findPreconditions } from "../world-model/causal-graph";
import type { SubGoal, DecompositionResult } from "./index";

export interface CausalDecompositionResult extends DecompositionResult {
  strategy: "causal" | "sequential" | "single";
  causalPath?: CausalEdge[];
}

/**
 * Decompose a goal using the causal graph.
 * Tries to find a path from current state to goal state.
 * Falls back to text-based decomposition if no causal path exists.
 */
export function causalDecompose(
  goal: string,
  currentState: string,
  goalState: string,
  graph: CausalGraph
): CausalDecompositionResult {
  // Try to find a causal path
  const path = findPath(graph, currentState, goalState);

  if (path.length > 0) {
    const subGoals: SubGoal[] = path.map((edge, i) => ({
      index: i,
      goal: describeAction(edge),
      dependsOn: i > 0 ? [i - 1] : []
    }));

    return {
      decomposed: true,
      subGoals,
      strategy: "causal",
      causalPath: path
    };
  }

  // Try precondition-based decomposition
  const preconditions = findPreconditions(graph, goalState);
  if (preconditions.length > 0) {
    const subGoals: SubGoal[] = [];

    // Add precondition sub-goals
    for (let i = 0; i < preconditions.length; i++) {
      const edge = preconditions[i];
      subGoals.push({
        index: i,
        goal: describeAction(edge),
        dependsOn: i > 0 ? [i - 1] : []
      });
    }

    // Add the original goal as the final step
    subGoals.push({
      index: subGoals.length,
      goal,
      dependsOn: subGoals.length > 0 ? [subGoals.length - 1] : []
    });

    return {
      decomposed: true,
      subGoals,
      strategy: "causal",
      causalPath: preconditions
    };
  }

  // No causal knowledge — return single goal
  return {
    decomposed: false,
    subGoals: [{ index: 0, goal, dependsOn: [] }],
    strategy: "single"
  };
}

/**
 * Infer goal state from a natural language goal string.
 * Maps common goal patterns to state node IDs.
 */
export function inferGoalState(goal: string): string {
  const lower = goal.toLowerCase();

  if (/dashboard/i.test(lower)) return "content:dashboard";
  if (/login|sign in/i.test(lower)) return "content:login";
  if (/screenshot/i.test(lower)) return "content:dashboard";  // assume screenshot = need to be on a page
  if (/assert.*"([^"]+)"/.test(lower)) {
    const match = lower.match(/assert.*"([^"]+)"/);
    if (match?.[1]?.includes("dashboard")) return "content:dashboard";
  }
  if (/authenticated|logged in/i.test(lower)) return "app:authenticated";

  return `goal:${lower.slice(0, 50)}`;
}

/**
 * Infer current state from RunContext-like info.
 */
export function inferCurrentState(info: {
  pageUrl?: string;
  appState?: string;
  visibleText?: string[];
}): string {
  const parts: string[] = [];

  if (info.pageUrl) {
    try {
      parts.push(`page:${new URL(info.pageUrl).pathname}`);
    } catch (error) {
      logModuleError("causal-decomposer", "optional", error, "URL parsing in state inference");
      parts.push(`page:${info.pageUrl}`);
    }
  }

  if (info.appState && info.appState !== "unknown") {
    parts.push(`app:${info.appState}`);
  }

  const text = (info.visibleText ?? []).join(" ").toLowerCase();
  if (/dashboard|home|welcome/i.test(text)) parts.push("content:dashboard");
  else if (/login|sign in/i.test(text)) parts.push("content:login");

  return parts.length > 0 ? parts.join("|") : "state:unknown";
}

function describeAction(edge: CausalEdge): string {
  const detail = edge.actionDetail ? ` "${edge.actionDetail}"` : "";
  return `${edge.action}${detail}`;
}
