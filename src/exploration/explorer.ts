/**
 * Autonomous Explorer — self-directed website discovery.
 * Given a starting URL, the explorer:
 * 1. Opens the page and observes all interactive elements
 * 2. Systematically interacts with elements and records state transitions
 * 3. Builds a navigation map (causal graph) of the website
 * 4. Reports discovered pages, actions, and anomalies
 */

import type { CausalGraph } from "../world-model/causal-graph";
import { createCausalGraph, addStateNode, addCausalEdge, findPath } from "../world-model/causal-graph";
import { classifyAction, classifyState } from "../world-model/pattern-abstractor";
import type { ActionableElementObservation } from "../cognition/types";

export interface ExplorationConfig {
  maxSteps: number;           // maximum interactions to try
  maxDepth: number;           // maximum navigation depth from start
  timeout: number;            // total exploration time limit (ms)
  avoidPatterns: string[];    // URL patterns to skip (e.g., "/logout", "/delete")
}

export const DEFAULT_EXPLORATION_CONFIG: ExplorationConfig = {
  maxSteps: 20,
  maxDepth: 3,
  timeout: 60000,
  avoidPatterns: ["logout", "sign-out", "delete", "remove", "unsubscribe"]
};

export interface ExploredPage {
  url: string;
  title: string;
  pageType: string;
  elements: ActionableElementObservation[];
  visitCount: number;
  discoveredAt: number;  // step index
}

export interface ExplorationAction {
  step: number;
  action: string;
  target: string;
  fromUrl: string;
  toUrl: string;
  fromState: string;
  toState: string;
  success: boolean;
  description: string;
}

export interface ExplorationReport {
  startUrl: string;
  totalSteps: number;
  pagesDiscovered: ExploredPage[];
  actionsPerformed: ExplorationAction[];
  causalGraph: CausalGraph;
  navigationMap: Map<string, string[]>;  // page → reachable pages
  anomalies: string[];
  summary: string;
}

/**
 * Plan an exploration strategy for a website.
 * Returns an ordered list of exploration actions to try.
 * Does NOT execute them — the caller (runtime) handles execution.
 */
export function planExploration(
  startUrl: string,
  elements: ActionableElementObservation[],
  visitedUrls: Set<string>,
  config: ExplorationConfig = DEFAULT_EXPLORATION_CONFIG
): ExplorationPlan {
  const actions: PlannedAction[] = [];

  // Prioritize elements that look like navigation
  const sorted = [...elements].sort((a, b) => {
    const aScore = elementPriority(a, config);
    const bScore = elementPriority(b, config);
    return bScore - aScore;
  });

  for (const element of sorted) {
    if (actions.length >= config.maxSteps) break;
    if (shouldSkipElement(element, config)) continue;

    actions.push({
      type: inferActionType(element),
      target: element.selector ?? element.text ?? "",
      description: element.text ?? element.role ?? "unknown element",
      priority: elementPriority(element, config),
      visited: false
    });
  }

  return {
    startUrl,
    actions,
    visitedUrls: new Set(visitedUrls)
  };
}

export interface ExplorationPlan {
  startUrl: string;
  actions: PlannedAction[];
  visitedUrls: Set<string>;
}

export interface PlannedAction {
  type: "click" | "navigate";
  target: string;
  description: string;
  priority: number;
  visited: boolean;
}

/**
 * Create an exploration report from collected data.
 */
export function createExplorationReport(
  startUrl: string,
  pages: ExploredPage[],
  actions: ExplorationAction[],
  graph: CausalGraph
): ExplorationReport {
  // Build navigation map
  const navMap = new Map<string, string[]>();
  for (const action of actions) {
    if (action.success && action.fromUrl !== action.toUrl) {
      const existing = navMap.get(action.fromUrl) ?? [];
      if (!existing.includes(action.toUrl)) {
        existing.push(action.toUrl);
        navMap.set(action.fromUrl, existing);
      }
    }
  }

  // Detect anomalies
  const anomalies: string[] = [];
  const errorPages = pages.filter(p => p.pageType === "error");
  if (errorPages.length > 0) {
    anomalies.push(`Found ${errorPages.length} error page(s): ${errorPages.map(p => p.url).join(", ")}`);
  }

  const deadEnds = pages.filter(p => {
    const outgoing = navMap.get(p.url);
    return !outgoing || outgoing.length === 0;
  });
  if (deadEnds.length > 1) {
    anomalies.push(`Found ${deadEnds.length} dead-end page(s) with no outgoing navigation`);
  }

  const totalPages = pages.length;
  const totalActions = actions.length;
  const successRate = actions.length > 0
    ? (actions.filter(a => a.success).length / actions.length * 100).toFixed(0)
    : "0";

  const summary = [
    `Explored ${startUrl}: ${totalPages} page(s), ${totalActions} action(s), ${successRate}% success rate.`,
    `Navigation paths: ${navMap.size} source page(s).`,
    anomalies.length > 0 ? `Anomalies: ${anomalies.join("; ")}` : "No anomalies found."
  ].join(" ");

  return {
    startUrl,
    totalSteps: actions.length,
    pagesDiscovered: pages,
    actionsPerformed: actions,
    causalGraph: graph,
    navigationMap: navMap,
    anomalies,
    summary
  };
}

function elementPriority(
  element: ActionableElementObservation,
  config: ExplorationConfig
): number {
  let score = element.confidence;
  const text = (element.text ?? "").toLowerCase();
  const role = (element.role ?? "").toLowerCase();

  // Navigation elements are highest priority
  if (role === "link" || /nav|menu/i.test(text)) score += 0.5;
  // Buttons that look like they lead somewhere
  if (role === "button" && /view|open|go|show|details/i.test(text)) score += 0.3;
  // Skip dangerous-looking elements
  if (config.avoidPatterns.some(p => text.includes(p))) score -= 2;
  // Skip inputs (exploration, not form-filling)
  if (role === "input") score -= 0.5;

  return score;
}

function shouldSkipElement(
  element: ActionableElementObservation,
  config: ExplorationConfig
): boolean {
  const text = (element.text ?? "").toLowerCase();
  return config.avoidPatterns.some(p => text.includes(p.toLowerCase()));
}

function inferActionType(element: ActionableElementObservation): "click" | "navigate" {
  if (element.role === "link") return "navigate";
  return "click";
}
