/**
 * Causal Graph — learns action→state transitions from run history.
 * Nodes are state descriptions, edges are actions that cause transitions.
 */

export interface StateNode {
  id: string;            // normalized state description, e.g. "page:login", "authenticated:true"
  domain: string;
  occurrences: number;
}

export interface CausalEdge {
  id: string;
  fromState: string;     // source state node id
  toState: string;       // target state node id
  action: string;        // task type, e.g. "click"
  actionDetail: string;  // selector or description, e.g. "#login-button"
  domain: string;
  successCount: number;
  failureCount: number;
  confidence: number;    // successCount / (successCount + failureCount)
}

export interface CausalGraph {
  nodes: Map<string, StateNode>;
  edges: Map<string, CausalEdge>;
  edgesBySource: Map<string, CausalEdge[]>;  // fromState → edges
  edgesByTarget: Map<string, CausalEdge[]>;  // toState → edges
}

export function createCausalGraph(): CausalGraph {
  return {
    nodes: new Map(),
    edges: new Map(),
    edgesBySource: new Map(),
    edgesByTarget: new Map()
  };
}

export function addStateNode(graph: CausalGraph, id: string, domain: string): StateNode {
  const existing = graph.nodes.get(id);
  if (existing) {
    existing.occurrences += 1;
    return existing;
  }
  const node: StateNode = { id, domain, occurrences: 1 };
  graph.nodes.set(id, node);
  return node;
}

export function addCausalEdge(
  graph: CausalGraph,
  fromState: string,
  toState: string,
  action: string,
  actionDetail: string,
  domain: string,
  success: boolean
): CausalEdge {
  const edgeId = `${fromState}→${action}:${actionDetail}→${toState}`;
  const existing = graph.edges.get(edgeId);

  if (existing) {
    if (success) existing.successCount += 1;
    else existing.failureCount += 1;
    existing.confidence = existing.successCount / (existing.successCount + existing.failureCount);
    return existing;
  }

  const edge: CausalEdge = {
    id: edgeId,
    fromState,
    toState,
    action,
    actionDetail,
    domain,
    successCount: success ? 1 : 0,
    failureCount: success ? 0 : 1,
    confidence: success ? 1 : 0
  };

  graph.edges.set(edgeId, edge);

  const sourceEdges = graph.edgesBySource.get(fromState) ?? [];
  sourceEdges.push(edge);
  graph.edgesBySource.set(fromState, sourceEdges);

  const targetEdges = graph.edgesByTarget.get(toState) ?? [];
  targetEdges.push(edge);
  graph.edgesByTarget.set(toState, targetEdges);

  return edge;
}

/**
 * Forward BFS: find a path from currentState to goalState.
 * Returns the sequence of edges (actions) to take, or empty if no path.
 */
export function findPath(
  graph: CausalGraph,
  currentState: string,
  goalState: string,
  maxDepth: number = 10
): CausalEdge[] {
  if (currentState === goalState) return [];

  const visited = new Set<string>();
  const queue: Array<{ state: string; path: CausalEdge[] }> = [{ state: currentState, path: [] }];

  while (queue.length > 0) {
    const { state, path } = queue.shift()!;
    if (visited.has(state)) continue;
    visited.add(state);

    if (path.length >= maxDepth) continue;

    const edges = graph.edgesBySource.get(state) ?? [];
    // Sort by confidence descending — prefer reliable transitions
    const sorted = [...edges].sort((a, b) => b.confidence - a.confidence);

    for (const edge of sorted) {
      if (edge.confidence < 0.3) continue; // skip unreliable edges
      const newPath = [...path, edge];
      if (edge.toState === goalState) return newPath;
      if (!visited.has(edge.toState)) {
        queue.push({ state: edge.toState, path: newPath });
      }
    }
  }

  return [];
}

/**
 * Backward search: find what preconditions are needed to reach goalState.
 * Returns edges that lead TO the goal state.
 */
export function findPreconditions(
  graph: CausalGraph,
  goalState: string
): CausalEdge[] {
  return (graph.edgesByTarget.get(goalState) ?? [])
    .filter(e => e.confidence >= 0.5)
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Serialize graph to JSON for persistence.
 */
export function serializeGraph(graph: CausalGraph): string {
  return JSON.stringify({
    nodes: Array.from(graph.nodes.values()),
    edges: Array.from(graph.edges.values())
  });
}

/**
 * Deserialize graph from JSON.
 */
export function deserializeGraph(json: string): CausalGraph {
  const graph = createCausalGraph();
  const data = JSON.parse(json) as { nodes: StateNode[]; edges: CausalEdge[] };

  for (const node of data.nodes) {
    graph.nodes.set(node.id, node);
  }

  for (const edge of data.edges) {
    graph.edges.set(edge.id, edge);
    const sourceEdges = graph.edgesBySource.get(edge.fromState) ?? [];
    sourceEdges.push(edge);
    graph.edgesBySource.set(edge.fromState, sourceEdges);
    const targetEdges = graph.edgesByTarget.get(edge.toState) ?? [];
    targetEdges.push(edge);
    graph.edgesByTarget.set(edge.toState, targetEdges);
  }

  return graph;
}

/**
 * Prune graph to fit within capacity limits.
 * Removes lowest-confidence edges and orphaned nodes.
 */
export function pruneGraph(
  graph: CausalGraph,
  maxNodes: number = 500,
  maxEdges: number = 2000
): { prunedNodes: number; prunedEdges: number } {
  let prunedEdges = 0;
  let prunedNodes = 0;

  // Prune edges by lowest confidence first
  if (graph.edges.size > maxEdges) {
    const sorted = Array.from(graph.edges.values())
      .sort((a, b) => a.confidence - b.confidence);
    const toRemove = sorted.slice(0, graph.edges.size - maxEdges);
    for (const edge of toRemove) {
      graph.edges.delete(edge.id);
      const sourceEdges = graph.edgesBySource.get(edge.fromState);
      if (sourceEdges) {
        const idx = sourceEdges.indexOf(edge);
        if (idx !== -1) sourceEdges.splice(idx, 1);
      }
      const targetEdges = graph.edgesByTarget.get(edge.toState);
      if (targetEdges) {
        const idx = targetEdges.indexOf(edge);
        if (idx !== -1) targetEdges.splice(idx, 1);
      }
      prunedEdges++;
    }
  }

  // Prune orphaned nodes (no edges referencing them)
  if (graph.nodes.size > maxNodes) {
    const referencedNodes = new Set<string>();
    for (const edge of graph.edges.values()) {
      referencedNodes.add(edge.fromState);
      referencedNodes.add(edge.toState);
    }
    const sorted = Array.from(graph.nodes.values())
      .filter(n => !referencedNodes.has(n.id))
      .sort((a, b) => a.occurrences - b.occurrences);
    const excess = graph.nodes.size - maxNodes;
    for (let i = 0; i < Math.min(excess, sorted.length); i++) {
      graph.nodes.delete(sorted[i].id);
      prunedNodes++;
    }
  }

  return { prunedNodes, prunedEdges };
}
