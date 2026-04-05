/**
 * Outcome Analyzer — aggregates results across multiple runs
 * to identify patterns in success/failure, strategy effectiveness,
 * and domain-specific behaviors.
 */

export interface RunOutcomeSummary {
  runId: string;
  domain: string;
  goal: string;
  success: boolean;
  taskCount: number;
  replanCount: number;
  failedTaskTypes: string[];
  recoveryStrategiesUsed: string[];
  durationMs: number;
  timestamp: string;
}

export interface DomainAnalysis {
  domain: string;
  totalRuns: number;
  successRate: number;
  avgReplans: number;
  topFailureTypes: Array<{ type: string; count: number; rate: number }>;
  effectiveStrategies: Array<{ strategy: string; successRate: number; uses: number }>;
  ineffectiveStrategies: Array<{ strategy: string; successRate: number; uses: number }>;
}

export interface StrategyEffectiveness {
  strategy: string;
  domain: string;
  uses: number;
  successes: number;
  successRate: number;
}

const MAX_OUTCOMES = 500;

/** In-memory outcome store. */
const outcomes: RunOutcomeSummary[] = [];

/**
 * Record a run outcome for later analysis.
 * Trims oldest entries when the cap is exceeded.
 */
export function recordOutcome(summary: RunOutcomeSummary): void {
  outcomes.push(summary);
  if (outcomes.length > MAX_OUTCOMES) {
    outcomes.splice(0, outcomes.length - MAX_OUTCOMES);
  }
}

/**
 * Aggregate analysis for a specific domain.
 */
export function analyzeDomain(domain: string): DomainAnalysis {
  const domainOutcomes = outcomes.filter((o) => o.domain === domain);
  const totalRuns = domainOutcomes.length;

  if (totalRuns === 0) {
    return {
      domain,
      totalRuns: 0,
      successRate: 0,
      avgReplans: 0,
      topFailureTypes: [],
      effectiveStrategies: [],
      ineffectiveStrategies: [],
    };
  }

  const successCount = domainOutcomes.filter((o) => o.success).length;
  const successRate = successCount / totalRuns;
  const avgReplans =
    domainOutcomes.reduce((sum, o) => sum + o.replanCount, 0) / totalRuns;

  // Aggregate failure types
  const failureCounts = new Map<string, number>();
  for (const o of domainOutcomes) {
    for (const ft of o.failedTaskTypes) {
      failureCounts.set(ft, (failureCounts.get(ft) ?? 0) + 1);
    }
  }
  const topFailureTypes = [...failureCounts.entries()]
    .map(([type, count]) => ({ type, count, rate: count / totalRuns }))
    .sort((a, b) => b.count - a.count);

  // Compute strategy effectiveness
  const strategyStats = computeStrategyStats(domainOutcomes, domain);

  const effective = strategyStats
    .filter((s) => s.successRate >= 0.5)
    .sort((a, b) => b.successRate - a.successRate);

  const ineffective = strategyStats
    .filter((s) => s.successRate < 0.5)
    .sort((a, b) => a.successRate - b.successRate);

  return {
    domain,
    totalRuns,
    successRate,
    avgReplans,
    topFailureTypes,
    effectiveStrategies: effective.map((s) => ({
      strategy: s.strategy,
      successRate: s.successRate,
      uses: s.uses,
    })),
    ineffectiveStrategies: ineffective.map((s) => ({
      strategy: s.strategy,
      successRate: s.successRate,
      uses: s.uses,
    })),
  };
}

/**
 * Return strategies that have a success rate >= 50% for the given domain,
 * sorted by success rate descending.
 */
export function getEffectiveStrategies(
  domain: string
): StrategyEffectiveness[] {
  const domainOutcomes = outcomes.filter((o) => o.domain === domain);
  return computeStrategyStats(domainOutcomes, domain)
    .filter((s) => s.successRate >= 0.5)
    .sort((a, b) => b.successRate - a.successRate);
}

/**
 * Return strategies that have a success rate < 50% for the given domain,
 * sorted by success rate ascending.
 */
export function getIneffectiveStrategies(
  domain: string
): StrategyEffectiveness[] {
  const domainOutcomes = outcomes.filter((o) => o.domain === domain);
  return computeStrategyStats(domainOutcomes, domain)
    .filter((s) => s.successRate < 0.5)
    .sort((a, b) => a.successRate - b.successRate);
}

/**
 * Clear all stored outcomes (useful for testing).
 */
export function clearOutcomes(): void {
  outcomes.length = 0;
}

// ---- internal helpers ----

function computeStrategyStats(
  domainOutcomes: RunOutcomeSummary[],
  domain: string
): StrategyEffectiveness[] {
  const stratMap = new Map<string, { uses: number; successes: number }>();

  for (const o of domainOutcomes) {
    for (const strat of o.recoveryStrategiesUsed) {
      const entry = stratMap.get(strat) ?? { uses: 0, successes: 0 };
      entry.uses += 1;
      if (o.success) {
        entry.successes += 1;
      }
      stratMap.set(strat, entry);
    }
  }

  return [...stratMap.entries()].map(([strategy, { uses, successes }]) => ({
    strategy,
    domain,
    uses,
    successes,
    successRate: uses > 0 ? successes / uses : 0,
  }));
}
