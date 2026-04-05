/**
 * Proactive Explorer — autonomously explores unknown pages to build
 * the causal graph and discover actionable elements.
 *
 * Uses a curiosity-driven strategy: the agent prefers states and elements
 * it has seen less often and where the causal graph has fewer outgoing edges.
 */

import { logModuleError } from "../core/module-logger";
import type { CausalGraph } from "../world-model/causal-graph";
import { addStateNode, addCausalEdge } from "../world-model/causal-graph";

export interface ExplorationConfig {
  maxSteps: number;       // default 20
  maxDepth: number;       // default 3 (pages deep from start)
  avoidPatterns: string[];  // URL patterns to avoid
  focusPatterns: string[];  // URL patterns to prioritize
}

export interface ExplorationResult {
  pagesVisited: string[];
  edgesLearned: number;
  statesDiscovered: number;
  elementsFound: Array<{ page: string; selector: string; text: string; type: string }>;
  durationMs: number;
}

export interface ExplorationElement {
  selector: string;
  text: string;
  type: string; // "link" | "button" | "input" | "other"
}

const DEFAULT_CONFIG: ExplorationConfig = {
  maxSteps: 20,
  maxDepth: 3,
  avoidPatterns: [],
  focusPatterns: [],
};

/**
 * Score an element for exploration curiosity.
 * Higher score = more interesting to explore.
 *
 * Factors:
 *  - Visit count of current state (less visited = higher curiosity)
 *  - Number of outgoing edges from current state (fewer = higher curiosity)
 *  - Element type weight (links > buttons > inputs > other)
 *  - Whether the element's selector appears in any existing edge (novel = higher)
 */
export function curiosityScore(
  element: ExplorationElement,
  currentState: string,
  graph: CausalGraph,
  visitCounts: Map<string, number>
): number {
  let score = 0;

  // State novelty: inversely proportional to visit count
  const visits = visitCounts.get(currentState) ?? 0;
  score += 1 / (1 + visits);

  // Graph sparsity: fewer outgoing edges means more to discover
  const outgoing = graph.edgesBySource.get(currentState) ?? [];
  score += 1 / (1 + outgoing.length);

  // Element type weight
  const typeWeights: Record<string, number> = {
    link: 1.5,
    button: 1.2,
    input: 0.5,
    other: 0.3,
  };
  score += typeWeights[element.type] ?? 0.3;

  // Novelty bonus: if the selector hasn't been seen in any edge, it's new
  const selectorSeen = outgoing.some((e) => e.actionDetail === element.selector);
  if (!selectorSeen) {
    score += 2.0;
  }

  // Text-based bonus: elements with meaningful text are more interesting
  if (element.text.length > 2) {
    score += 0.5;
  }

  return score;
}

/**
 * Strategy for choosing the next exploration action.
 *
 * Returns the best action to take given the current state,
 * existing causal graph knowledge, and available elements.
 */
export function selectNextExplorationAction(
  currentState: string,
  graph: CausalGraph,
  visitCounts: Map<string, number>,
  availableElements: ExplorationElement[]
): { action: "click" | "navigate" | "stop"; target?: string; reason: string } {
  // If there are no elements to interact with, stop
  if (availableElements.length === 0) {
    return { action: "stop", reason: "No actionable elements available" };
  }

  // Score all elements
  const scored = availableElements.map((el) => ({
    element: el,
    score: curiosityScore(el, currentState, graph, visitCounts),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];

  // If the best score is very low, we've explored enough
  if (best.score < 0.5) {
    return { action: "stop", reason: "Curiosity exhausted — all elements well-explored" };
  }

  // Determine action type based on element type
  const actionType = best.element.type === "link" ? "navigate" : "click";
  const reason =
    `Curiosity score ${best.score.toFixed(2)} for ` +
    `${best.element.type} "${best.element.text || best.element.selector}"`;

  return { action: actionType, target: best.element.selector, reason };
}

/**
 * Run proactive exploration, updating the causal graph as we go.
 *
 * This is the main entry point. It takes callbacks for interacting with
 * the environment (getting elements, performing actions, observing state).
 */
export async function explore(
  startState: string,
  domain: string,
  graph: CausalGraph,
  config: Partial<ExplorationConfig>,
  callbacks: {
    getElements: () => Promise<ExplorationElement[]>;
    performAction: (action: "click" | "navigate", target: string) => Promise<string>; // returns new state
    getCurrentPage: () => string;
  }
): Promise<ExplorationResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const visitCounts = new Map<string, number>();
  const pagesVisited = new Set<string>();
  const elementsFound: ExplorationResult["elementsFound"] = [];
  let edgesLearned = 0;
  let statesDiscovered = 0;
  const startTime = Date.now();

  let currentState = startState;
  addStateNode(graph, currentState, domain);
  statesDiscovered++;

  for (let step = 0; step < cfg.maxSteps; step++) {
    // Track visit
    visitCounts.set(currentState, (visitCounts.get(currentState) ?? 0) + 1);
    pagesVisited.add(callbacks.getCurrentPage());

    // Get available elements
    const elements = await callbacks.getElements();

    // Filter elements based on avoid/focus patterns
    const filtered = elements.filter((el) => {
      if (cfg.avoidPatterns.some((p) => el.selector.includes(p))) return false;
      return true;
    });

    // Record found elements
    const page = callbacks.getCurrentPage();
    for (const el of filtered) {
      elementsFound.push({ page, selector: el.selector, text: el.text, type: el.type });
    }

    // Choose next action
    const decision = selectNextExplorationAction(currentState, graph, visitCounts, filtered);
    if (decision.action === "stop" || !decision.target) break;

    // Execute action
    const previousState = currentState;
    try {
      currentState = await callbacks.performAction(decision.action, decision.target);
    } catch (error) {
      logModuleError("proactive-explorer", "optional", error, "exploration action failed");
      addCausalEdge(graph, previousState, previousState, decision.action, decision.target, domain, false);
      edgesLearned++;
      continue;
    }

    // Record new state and edge
    if (!graph.nodes.has(currentState)) {
      statesDiscovered++;
    }
    addStateNode(graph, currentState, domain);
    addCausalEdge(graph, previousState, currentState, decision.action, decision.target, domain, true);
    edgesLearned++;
  }

  return {
    pagesVisited: [...pagesVisited],
    edgesLearned,
    statesDiscovered,
    elementsFound,
    durationMs: Date.now() - startTime,
  };
}
