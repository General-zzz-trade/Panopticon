/**
 * Causal Graph Registry — global singleton for cross-module access.
 *
 * Allows the persistence layer to save/restore the active causal graph
 * without circular imports to the runtime.
 */

import { createCausalGraph, type CausalGraph } from "./causal-graph";

let activeGraph: CausalGraph | null = null;

/**
 * Get the active causal graph, or null if none set.
 */
export function getActiveCausalGraph(): CausalGraph | null {
  return activeGraph;
}

/**
 * Set the active causal graph (called on restore or run init).
 */
export function setActiveCausalGraph(graph: CausalGraph): void {
  activeGraph = graph;
}

/**
 * Get or create the active causal graph.
 * If a graph was restored from persistence, returns that.
 * Otherwise creates a fresh one and sets it as active.
 */
export function getOrCreateCausalGraph(): CausalGraph {
  if (activeGraph) return activeGraph;
  activeGraph = createCausalGraph();
  return activeGraph;
}
