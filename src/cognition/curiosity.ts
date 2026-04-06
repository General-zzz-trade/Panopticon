/**
 * Curiosity Engine — autonomous goal generation based on knowledge gaps.
 *
 * Analyzes the causal graph and episode history to identify:
 * 1. Unexplored edges (states reachable but never visited)
 * 2. Low-confidence transitions (actions that sometimes fail)
 * 3. Domains with few episodes (unfamiliar territory)
 * 4. Failed goals worth retrying (with learned recovery strategies)
 *
 * Generates prioritized goal suggestions for autonomous exploration.
 */

import type { CausalGraph, CausalEdge } from "../world-model/causal-graph";
import { deserializeGraph } from "../world-model/causal-graph";
import { getRecentEpisodes, getEpisodeStats } from "../memory/episode-store";
import { getKnowledgeStats, getLessonsForTaskType } from "../knowledge/store";
import { readProviderConfig, callOpenAICompatible, callAnthropic, safeJsonParse } from "../llm/provider";
import type { LLMMessage } from "../llm/provider";
import * as fs from "fs";
import { logModuleError } from "../core/module-logger";

export interface GoalSuggestion {
  goal: string;
  reason: string;
  priority: number;      // 0-1, higher = more important
  source: "unexplored" | "low_confidence" | "retry_failure" | "llm_generated" | "coverage_gap";
  domain?: string;
}

/**
 * Generate autonomous goal suggestions based on current knowledge state.
 */
export function generateGoalSuggestions(maxSuggestions: number = 5): GoalSuggestion[] {
  const suggestions: GoalSuggestion[] = [];

  // Source 1: Unexplored states in causal graph
  try {
    suggestions.push(...findUnexploredStates());
  } catch (error) { logModuleError("curiosity", "optional", error, "finding unexplored states"); }

  // Source 2: Low-confidence transitions worth reinforcing
  try {
    suggestions.push(...findLowConfidenceTransitions());
  } catch (error) { logModuleError("curiosity", "optional", error, "finding low-confidence transitions"); }

  // Source 3: Failed goals worth retrying
  try {
    suggestions.push(...findRetryableFailures());
  } catch (error) { logModuleError("curiosity", "optional", error, "finding retryable failures"); }

  // Source 4: Coverage gaps (task types rarely tested)
  try {
    suggestions.push(...findCoverageGaps());
  } catch (error) { logModuleError("curiosity", "optional", error, "finding coverage gaps"); }

  // Sort by priority and deduplicate
  return suggestions
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxSuggestions);
}

/**
 * Use LLM to generate creative goal suggestions based on what the agent knows.
 */
export async function generateLLMGoalSuggestions(
  context: { domains: string[]; recentGoals: string[]; failedGoals: string[] },
  maxSuggestions: number = 3
): Promise<GoalSuggestion[]> {
  const config = readProviderConfig("LLM_CURIOSITY", { maxTokens: 600, temperature: 0.7 });
  if (!config.provider || !config.apiKey) return [];

  const messages: LLMMessage[] = [
    {
      role: "system",
      content: `You are a curious OSINT agent that explores intelligence gathering opportunities. Based on what you've learned so far, suggest new goals to explore. Each goal should be a concrete, executable instruction.

Respond with JSON:
{
  "suggestions": [
    { "goal": "actionable instruction", "reason": "why this is interesting", "priority": 0.0-1.0 }
  ]
}`
    },
    {
      role: "user",
      content: `Known domains: ${context.domains.join(", ") || "none"}
Recent goals tried: ${context.recentGoals.slice(-5).join("; ") || "none"}
Failed goals: ${context.failedGoals.slice(-3).join("; ") || "none"}

What should I explore or test next? Suggest ${maxSuggestions} goals.`
    }
  ];

  try {
    const result = config.provider === "anthropic"
      ? await callAnthropic(config, messages, "Curiosity")
      : await callOpenAICompatible(config, messages, "Curiosity");

    const parsed = safeJsonParse(result.content) as { suggestions?: Array<{ goal: string; reason: string; priority: number }> } | undefined;
    if (!parsed?.suggestions) return [];

    return parsed.suggestions.map(s => ({
      goal: s.goal,
      reason: s.reason,
      priority: Math.max(0, Math.min(1, s.priority)),
      source: "llm_generated" as const
    }));
  } catch (error) {
    logModuleError("curiosity", "optional", error, "generating LLM goal suggestions");
    return [];
  }
}

/**
 * Get a summary of the agent's current knowledge for display.
 */
export function getKnowledgeSummary(): {
  totalEpisodes: number;
  successRate: number;
  knownDomains: string[];
  totalKnowledge: number;
  suggestions: GoalSuggestion[];
} {
  let totalEpisodes = 0;
  let successCount = 0;
  const knownDomains = new Set<string>();

  try {
    const stats = getEpisodeStats();
    totalEpisodes = stats.total;
    successCount = stats.byOutcome["success"] ?? 0;

    const episodes = getRecentEpisodes(100);
    for (const ep of episodes) {
      if (ep.domain) knownDomains.add(ep.domain);
    }
  } catch (error) { logModuleError("curiosity", "optional", error, "fetching episode stats"); }

  let totalKnowledge = 0;
  try {
    const kStats = getKnowledgeStats();
    totalKnowledge = kStats.selectors + kStats.lessons + kStats.templates;
  } catch (error) { logModuleError("curiosity", "optional", error, "fetching knowledge stats"); }

  return {
    totalEpisodes,
    successRate: totalEpisodes > 0 ? successCount / totalEpisodes : 0,
    knownDomains: Array.from(knownDomains),
    totalKnowledge,
    suggestions: generateGoalSuggestions()
  };
}

// --- Internal helpers ---

function loadCausalGraph(): CausalGraph | null {
  try {
    const graphPath = require("path").join(process.cwd(), "artifacts", "causal-graph.json");
    if (!fs.existsSync(graphPath)) return null;
    return deserializeGraph(fs.readFileSync(graphPath, "utf-8"));
  } catch (error) {
    logModuleError("curiosity", "optional", error, "loading causal graph");
    return null;
  }
}

function findUnexploredStates(): GoalSuggestion[] {
  const graph = loadCausalGraph();
  if (!graph || graph.nodes.size < 2) return [];

  const suggestions: GoalSuggestion[] = [];

  // Find states with outgoing edges but low visit counts
  for (const [nodeId, node] of graph.nodes) {
    if (node.occurrences <= 1) {
      const outgoing = graph.edgesBySource.get(nodeId) ?? [];
      if (outgoing.length === 0) {
        // Dead-end state — worth exploring from
        suggestions.push({
          goal: `explore state "${nodeId}" — no known outgoing transitions`,
          reason: `State "${nodeId}" has been visited ${node.occurrences} time(s) but has no known next actions`,
          priority: 0.7,
          source: "unexplored",
          domain: node.domain
        });
      }
    }
  }

  return suggestions.slice(0, 3);
}

function findLowConfidenceTransitions(): GoalSuggestion[] {
  const graph = loadCausalGraph();
  if (!graph) return [];

  const suggestions: GoalSuggestion[] = [];

  for (const edge of graph.edges.values()) {
    if (edge.confidence > 0.3 && edge.confidence < 0.7 && edge.successCount + edge.failureCount >= 2) {
      suggestions.push({
        goal: `retry ${edge.action} "${edge.actionDetail}" (from ${edge.fromState} to ${edge.toState})`,
        reason: `This transition has ${Math.round(edge.confidence * 100)}% confidence (${edge.successCount} success, ${edge.failureCount} failure) — more data needed`,
        priority: 0.5 + (1 - edge.confidence) * 0.3,
        source: "low_confidence",
        domain: edge.domain
      });
    }
  }

  return suggestions.sort((a, b) => b.priority - a.priority).slice(0, 3);
}

function findRetryableFailures(): GoalSuggestion[] {
  const suggestions: GoalSuggestion[] = [];

  try {
    const episodes = getRecentEpisodes(50);
    const failures = episodes.filter(e => e.outcome === "failure");

    // Group by goal to find repeated failures
    const goalFailures = new Map<string, number>();
    for (const ep of failures) {
      goalFailures.set(ep.goal, (goalFailures.get(ep.goal) ?? 0) + 1);
    }

    for (const [goal, count] of goalFailures) {
      if (count >= 1 && count <= 3) {
        // Check if we've learned new recovery strategies since the failure
        const lessons = getLessonsForTaskType("click").concat(getLessonsForTaskType("type"));
        const hasNewStrategies = lessons.length > 0;

        if (hasNewStrategies) {
          suggestions.push({
            goal,
            reason: `Failed ${count} time(s) but new recovery strategies have been learned since then`,
            priority: 0.6,
            source: "retry_failure"
          });
        }
      }
    }
  } catch (error) { logModuleError("curiosity", "optional", error, "finding retryable failure episodes"); }

  return suggestions.slice(0, 2);
}

function findCoverageGaps(): GoalSuggestion[] {
  const suggestions: GoalSuggestion[] = [];

  try {
    const stats = getKnowledgeStats();

    // If we have few selectors but many lessons, we need more successful interactions
    if (stats.selectors < 5 && stats.lessons > 10) {
      suggestions.push({
        goal: "explore a known page and interact with all visible elements",
        reason: `Only ${stats.selectors} selectors mapped but ${stats.lessons} failure lessons — need more successful interactions`,
        priority: 0.55,
        source: "coverage_gap"
      });
    }

    // If we have no templates, we need more successful runs to learn patterns
    if (stats.templates === 0 && stats.lessons > 0) {
      suggestions.push({
        goal: "complete a simple end-to-end flow (open page, interact, verify) to establish a reusable template",
        reason: "No task templates learned yet — need at least one successful end-to-end run",
        priority: 0.65,
        source: "coverage_gap"
      });
    }
  } catch (error) { logModuleError("curiosity", "optional", error, "checking coverage gaps"); }

  return suggestions;
}
