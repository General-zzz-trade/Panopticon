/**
 * Self Model — tracks the agent's own capability profile based on
 * historical performance across domains. Enables the agent to reason
 * about its own strengths, weaknesses, and optimal strategies.
 */

import {
  saveLearningState,
  loadLearningState,
} from "../learning/persistence";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DomainProfile {
  domain: string;
  totalRuns: number;
  successCount: number;
  successRate: number;
  avgTaskCount: number;
  avgReplanCount: number;
  commonFailures: Array<{ pattern: string; count: number }>;
  lastUpdated: string;
}

export interface SelfModel {
  profiles: Map<string, DomainProfile>;
  overallSuccessRate: number;
  totalRuns: number;
  strongDomains: string[];
  weakDomains: string[];
}

// ── Persistence key ─────────────────────────────────────────────────────────

const PERSISTENCE_KEY = "self_model";

interface SerializedSelfModel {
  profiles: Array<[string, DomainProfile]>;
  overallSuccessRate: number;
  totalRuns: number;
  strongDomains: string[];
  weakDomains: string[];
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createSelfModel(): SelfModel {
  // Try to restore from persistence
  const saved = loadLearningState<SerializedSelfModel>(PERSISTENCE_KEY);
  if (saved) {
    return {
      profiles: new Map(saved.profiles),
      overallSuccessRate: saved.overallSuccessRate,
      totalRuns: saved.totalRuns,
      strongDomains: saved.strongDomains,
      weakDomains: saved.weakDomains,
    };
  }

  return {
    profiles: new Map(),
    overallSuccessRate: 0,
    totalRuns: 0,
    strongDomains: [],
    weakDomains: [],
  };
}

// ── Persistence ─────────────────────────────────────────────────────────────

function persistSelfModel(model: SelfModel): void {
  const serialized: SerializedSelfModel = {
    profiles: Array.from(model.profiles.entries()),
    overallSuccessRate: model.overallSuccessRate,
    totalRuns: model.totalRuns,
    strongDomains: model.strongDomains,
    weakDomains: model.weakDomains,
  };
  saveLearningState(PERSISTENCE_KEY, serialized);
}

// ── Core Operations ─────────────────────────────────────────────────────────

export function recordRunOutcome(
  model: SelfModel,
  domain: string,
  success: boolean,
  taskCount: number,
  replanCount: number,
  failures: string[]
): void {
  let profile = model.profiles.get(domain);

  if (!profile) {
    profile = {
      domain,
      totalRuns: 0,
      successCount: 0,
      successRate: 0,
      avgTaskCount: 0,
      avgReplanCount: 0,
      commonFailures: [],
      lastUpdated: new Date().toISOString(),
    };
    model.profiles.set(domain, profile);
  }

  // Update counts
  profile.totalRuns += 1;
  if (success) profile.successCount += 1;
  profile.successRate = profile.successCount / profile.totalRuns;

  // Update running averages
  profile.avgTaskCount =
    (profile.avgTaskCount * (profile.totalRuns - 1) + taskCount) /
    profile.totalRuns;
  profile.avgReplanCount =
    (profile.avgReplanCount * (profile.totalRuns - 1) + replanCount) /
    profile.totalRuns;

  // Track failure patterns
  for (const failure of failures) {
    const normalized = normalizeFailurePattern(failure);
    const existing = profile.commonFailures.find(
      (f) => f.pattern === normalized
    );
    if (existing) {
      existing.count += 1;
    } else {
      profile.commonFailures.push({ pattern: normalized, count: 1 });
    }
  }

  // Sort failures by frequency descending, keep top 20
  profile.commonFailures.sort((a, b) => b.count - a.count);
  if (profile.commonFailures.length > 20) {
    profile.commonFailures = profile.commonFailures.slice(0, 20);
  }

  profile.lastUpdated = new Date().toISOString();

  // Recalculate overall stats
  recalculateOverall(model);

  // Persist
  try {
    persistSelfModel(model);
  } catch {
    // Persistence is best-effort; don't break the caller
  }
}

function normalizeFailurePattern(failure: string): string {
  // Collapse whitespace, lowercase, truncate
  return failure.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

function recalculateOverall(model: SelfModel): void {
  let totalRuns = 0;
  let totalSuccess = 0;

  for (const profile of model.profiles.values()) {
    totalRuns += profile.totalRuns;
    totalSuccess += profile.successCount;
  }

  model.totalRuns = totalRuns;
  model.overallSuccessRate = totalRuns > 0 ? totalSuccess / totalRuns : 0;

  // Classify domains — only domains with >= 3 runs
  model.strongDomains = [];
  model.weakDomains = [];

  for (const profile of model.profiles.values()) {
    if (profile.totalRuns < 3) continue;
    if (profile.successRate > 0.7) {
      model.strongDomains.push(profile.domain);
    } else if (profile.successRate < 0.4) {
      model.weakDomains.push(profile.domain);
    }
  }
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function getDomainProfile(
  model: SelfModel,
  domain: string
): DomainProfile | undefined {
  return model.profiles.get(domain);
}

export function getStrengthAssessment(
  model: SelfModel,
  domain: string
): {
  strength: "strong" | "moderate" | "weak" | "unknown";
  confidence: number;
  rationale: string;
} {
  const profile = model.profiles.get(domain);

  if (!profile || profile.totalRuns === 0) {
    return {
      strength: "unknown",
      confidence: 0,
      rationale: `No historical data for domain "${domain}".`,
    };
  }

  // Confidence scales with number of runs (diminishing returns)
  const confidence = Math.min(1, profile.totalRuns / 20);

  if (profile.totalRuns < 3) {
    return {
      strength: "unknown",
      confidence,
      rationale: `Only ${profile.totalRuns} run(s) recorded for "${domain}" — insufficient data.`,
    };
  }

  const rate = profile.successRate;

  if (rate > 0.7) {
    return {
      strength: "strong",
      confidence,
      rationale: `${(rate * 100).toFixed(0)}% success rate across ${profile.totalRuns} runs in "${domain}".`,
    };
  }

  if (rate < 0.4) {
    const topFailure = profile.commonFailures[0];
    const failureNote = topFailure
      ? ` Most common failure: "${topFailure.pattern}" (${topFailure.count}x).`
      : "";
    return {
      strength: "weak",
      confidence,
      rationale: `${(rate * 100).toFixed(0)}% success rate across ${profile.totalRuns} runs in "${domain}".${failureNote}`,
    };
  }

  return {
    strength: "moderate",
    confidence,
    rationale: `${(rate * 100).toFixed(0)}% success rate across ${profile.totalRuns} runs in "${domain}".`,
  };
}

// ── Strategy Suggestions ────────────────────────────────────────────────────

export function suggestStrategyForDomain(
  model: SelfModel,
  domain: string
): string[] {
  const profile = model.profiles.get(domain);
  const suggestions: string[] = [];

  if (!profile || profile.totalRuns === 0) {
    suggestions.push("No historical data — use conservative exploration strategy.");
    suggestions.push("Start with template-based planning for predictable execution.");
    suggestions.push("Enable verbose observation to build domain knowledge.");
    return suggestions;
  }

  // High replan rate suggests planning issues
  if (profile.avgReplanCount > 2) {
    suggestions.push(
      "High replan rate detected — consider using LLM planner for better initial plans."
    );
  }

  // High task count suggests over-decomposition
  if (profile.avgTaskCount > 10) {
    suggestions.push(
      "High average task count — try coarser task decomposition to reduce execution overhead."
    );
  }

  // Analyze common failures for specific recommendations
  for (const failure of profile.commonFailures.slice(0, 5)) {
    if (/selector/i.test(failure.pattern)) {
      suggestions.push(
        `Selector-related failures common (${failure.count}x) — prefer text-based or ARIA selectors.`
      );
    } else if (/timeout|slow|loading/i.test(failure.pattern)) {
      suggestions.push(
        `Timeout failures common (${failure.count}x) — increase wait times and add loading checks.`
      );
    } else if (/auth|login|session/i.test(failure.pattern)) {
      suggestions.push(
        `Authentication failures common (${failure.count}x) — ensure session is established before task execution.`
      );
    } else if (/state|stale/i.test(failure.pattern)) {
      suggestions.push(
        `State-related failures common (${failure.count}x) — add state verification steps between tasks.`
      );
    } else if (/not\s*found|missing|element/i.test(failure.pattern)) {
      suggestions.push(
        `Element-not-found failures common (${failure.count}x) — add observation steps before interactions.`
      );
    }
  }

  // Weak domain: suggest more caution
  if (profile.successRate < 0.4 && profile.totalRuns >= 3) {
    suggestions.push(
      "Low success rate in this domain — consider smaller goals and more checkpoints."
    );
  }

  // Strong domain: suggest efficiency optimizations
  if (profile.successRate > 0.7 && profile.totalRuns >= 3) {
    suggestions.push(
      "Strong domain — can use aggressive parallelization and fewer verification steps."
    );
  }

  if (suggestions.length === 0) {
    suggestions.push("Moderate performance — use balanced strategy with standard verification.");
  }

  return suggestions;
}
