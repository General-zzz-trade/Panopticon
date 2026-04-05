/**
 * Execution Graph — DAG-based task execution with branching and parallelism.
 *
 * Nodes are tasks or decision points. Edges carry conditions (success/failure/always).
 * Used when the planner produces a plan with branches or parallel groups.
 * Falls back to linear execution for simple sequential plans.
 */

import type { AgentTask } from "../types";
import type { SubGoal } from "../orchestration/llm-decomposer";
import { getParallelGroups } from "../orchestration/llm-decomposer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EdgeCondition = "success" | "failure" | "always" | "timeout";

export interface ExecutionNode {
  id: string;
  taskId: string;
  type: "task" | "decision" | "fork" | "join";
  status: "pending" | "running" | "done" | "failed" | "skipped";
  result?: { success: boolean; summary: string };
}

export interface ExecutionEdge {
  from: string;
  to: string;
  condition: EdgeCondition;
}

export interface ExecutionGraph {
  nodes: Map<string, ExecutionNode>;
  edges: ExecutionEdge[];
  rootIds: string[];
}

export interface GraphSummary {
  total: number;
  done: number;
  failed: number;
  skipped: number;
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

/**
 * Creates a linear graph from a task array (backward compatible).
 * Each task becomes a node; edges connect sequentially with condition="success".
 */
export function createGraphFromTasks(tasks: AgentTask[]): ExecutionGraph {
  const nodes = new Map<string, ExecutionNode>();
  const edges: ExecutionEdge[] = [];

  for (const task of tasks) {
    nodes.set(task.id, {
      id: task.id,
      taskId: task.id,
      type: "task",
      status: "pending",
    });
  }

  for (let i = 0; i < tasks.length - 1; i++) {
    edges.push({
      from: tasks[i].id,
      to: tasks[i + 1].id,
      condition: "success",
    });
  }

  const rootIds = tasks.length > 0 ? [tasks[0].id] : [];

  return { nodes, edges, rootIds };
}

/**
 * Creates a branching graph from decomposed sub-goals with dependsOn.
 * Uses getParallelGroups() to identify parallel execution opportunities.
 */
export function createGraphFromDAG(subGoals: SubGoal[]): ExecutionGraph {
  const nodes = new Map<string, ExecutionNode>();
  const edges: ExecutionEdge[] = [];

  // Create a node per sub-goal
  for (const sg of subGoals) {
    nodes.set(sg.id, {
      id: sg.id,
      taskId: sg.id,
      type: "task",
      status: "pending",
    });
  }

  // Build edges from dependsOn relationships
  for (const sg of subGoals) {
    for (const dep of sg.dependsOn) {
      edges.push({
        from: dep,
        to: sg.id,
        condition: "success",
      });
    }
  }

  // Identify parallel groups to insert fork/join nodes where needed
  const groups = getParallelGroups(subGoals);

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];

    // If a group has more than one node, insert fork and join nodes
    if (group.length > 1) {
      const forkId = `fork-${gi}`;
      const joinId = `join-${gi}`;

      nodes.set(forkId, {
        id: forkId,
        taskId: forkId,
        type: "fork",
        status: "pending",
      });

      nodes.set(joinId, {
        id: joinId,
        taskId: joinId,
        type: "join",
        status: "pending",
      });

      // fork -> each node in group (always, since fork is a control node)
      for (const sg of group) {
        edges.push({ from: forkId, to: sg.id, condition: "always" });
      }

      // each node in group -> join (success)
      for (const sg of group) {
        edges.push({ from: sg.id, to: joinId, condition: "success" });
      }

      // Connect previous group's join (or previous nodes) to this fork
      if (gi > 0) {
        const prevGroup = groups[gi - 1];
        if (prevGroup.length > 1) {
          // previous group had a join node
          const prevJoinId = `join-${gi - 1}`;
          edges.push({ from: prevJoinId, to: forkId, condition: "success" });
        } else {
          // single-node previous group: connect it to this fork
          edges.push({ from: prevGroup[0].id, to: forkId, condition: "success" });
        }
      }

      // If there's a next group, connect join -> next
      if (gi + 1 < groups.length) {
        const nextGroup = groups[gi + 1];
        if (nextGroup.length > 1) {
          // handled when processing next group
        } else {
          // single next node — connect join to it (only if the next node
          // doesn't already have an edge from a group member via dependsOn)
          // We let the dependsOn edges handle the connectivity.
        }
      }
    }
  }

  // Compute root IDs: nodes with no incoming edges
  const hasIncoming = new Set<string>();
  for (const edge of edges) {
    hasIncoming.add(edge.to);
  }

  const rootIds: string[] = [];
  for (const id of nodes.keys()) {
    if (!hasIncoming.has(id)) {
      rootIds.push(id);
    }
  }

  return { nodes, edges, rootIds };
}

// ---------------------------------------------------------------------------
// Graph traversal helpers
// ---------------------------------------------------------------------------

/**
 * Returns nodes whose dependencies are all satisfied.
 * A dependency is satisfied when all incoming edges' conditions match the
 * source node's terminal status, OR the edge condition is "always".
 */
export function getReadyNodes(graph: ExecutionGraph): ExecutionNode[] {
  const ready: ExecutionNode[] = [];

  for (const node of graph.nodes.values()) {
    if (node.status !== "pending") continue;

    const incoming = graph.edges.filter(e => e.to === node.id);

    // Root nodes (no incoming edges) are ready immediately
    if (incoming.length === 0) {
      ready.push(node);
      continue;
    }

    // For join nodes: ALL incoming edges must be satisfied
    // For other nodes: ALL incoming edges must be satisfied
    const allSatisfied = incoming.every(edge => {
      const source = graph.nodes.get(edge.from);
      if (!source) return false;
      return isEdgeSatisfied(edge, source);
    });

    if (allSatisfied) {
      ready.push(node);
    }
  }

  return ready;
}

/**
 * Check whether an edge's condition is satisfied by the source node's status.
 */
function isEdgeSatisfied(edge: ExecutionEdge, source: ExecutionNode): boolean {
  if (edge.condition === "always") {
    // "always" edges are satisfied when the source is in any terminal state
    return source.status === "done" || source.status === "failed" || source.status === "skipped";
  }
  if (edge.condition === "success") {
    return source.status === "done";
  }
  if (edge.condition === "failure") {
    return source.status === "failed";
  }
  if (edge.condition === "timeout") {
    // Timeout is treated as a failure variant; source must be failed
    return source.status === "failed";
  }
  return false;
}

/**
 * Mark a node as done or failed and update its result.
 * Also propagates skipped status to unreachable successors.
 */
export function completeNode(
  graph: ExecutionGraph,
  nodeId: string,
  success: boolean,
  summary: string
): void {
  const node = graph.nodes.get(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found in graph`);

  node.status = success ? "done" : "failed";
  node.result = { success, summary };

  // Propagate: skip nodes that can never be reached
  propagateSkips(graph);
}

/**
 * Walk the graph and mark nodes as skipped if their dependencies can never
 * be satisfied. A node is unreachable when at least one incoming edge
 * requires a condition that can never be met (e.g., "success" edge from a
 * failed node, and no "failure" or "always" alternate path exists).
 */
function propagateSkips(graph: ExecutionGraph): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes.values()) {
      if (node.status !== "pending") continue;

      const incoming = graph.edges.filter(e => e.to === node.id);
      if (incoming.length === 0) continue;

      // A node should be skipped if ANY required incoming edge can never be satisfied
      const shouldSkip = incoming.some(edge => {
        const source = graph.nodes.get(edge.from);
        if (!source) return true; // missing source => unreachable

        // Source still pending or running — can't determine yet
        if (source.status === "pending" || source.status === "running") return false;

        // Source is terminal — check if the edge condition matches
        return !isEdgeSatisfied(edge, source) && !canStillBeSatisfied(edge, source);
      });

      if (shouldSkip) {
        node.status = "skipped";
        node.result = { success: false, summary: "Skipped: dependency condition not met" };
        changed = true;
      }
    }
  }
}

/**
 * Can an edge still potentially be satisfied? Only if the source is not yet terminal.
 */
function canStillBeSatisfied(edge: ExecutionEdge, source: ExecutionNode): boolean {
  // Source is in a terminal state and edge is not satisfied — it will never be
  if (source.status === "done" || source.status === "failed" || source.status === "skipped") {
    return isEdgeSatisfied(edge, source);
  }
  // Source is still pending/running — could still be satisfied
  return true;
}

/**
 * Returns true when all nodes are in a terminal state (done, failed, or skipped).
 */
export function isGraphComplete(graph: ExecutionGraph): boolean {
  for (const node of graph.nodes.values()) {
    if (node.status === "pending" || node.status === "running") {
      return false;
    }
  }
  return true;
}

/**
 * Get a summary of the graph's current status.
 */
export function getGraphSummary(graph: ExecutionGraph): GraphSummary {
  let total = 0;
  let done = 0;
  let failed = 0;
  let skipped = 0;

  for (const node of graph.nodes.values()) {
    total++;
    if (node.status === "done") done++;
    else if (node.status === "failed") failed++;
    else if (node.status === "skipped") skipped++;
  }

  return { total, done, failed, skipped };
}
