/**
 * Domain Strategy — derives domain-level strategy patterns
 * from outcome analysis. Translates aggregate data into
 * actionable recommendations for future runs.
 */

import {
  analyzeDomain,
  getEffectiveStrategies,
  getIneffectiveStrategies,
} from "./outcome-analyzer";

export interface DomainStrategy {
  domain: string;
  /** Ordered list of recommended approaches */
  approaches: StrategyApproach[];
  /** Things to avoid in this domain */
  antiPatterns: string[];
  /** Confidence in this strategy (based on data volume) */
  confidence: number;
  lastUpdated: string;
}

export interface StrategyApproach {
  name: string;
  description: string;
  conditions: string[];
  priority: number;
}

/** Cached strategies keyed by domain. */
const strategyCache = new Map<string, DomainStrategy>();

/**
 * Derive a domain strategy from aggregated outcome data.
 * Higher-success-rate strategies get higher priority.
 */
export function computeDomainStrategy(domain: string): DomainStrategy {
  const analysis = analyzeDomain(domain);
  const effective = getEffectiveStrategies(domain);
  const ineffective = getIneffectiveStrategies(domain);

  // Build approaches from effective strategies, ranked by success rate
  const approaches: StrategyApproach[] = effective.map((s, idx) => ({
    name: s.strategy,
    description: `Strategy "${s.strategy}" with ${Math.round(s.successRate * 100)}% success rate across ${s.uses} uses`,
    conditions: [`domain=${domain}`, `uses>=${s.uses}`],
    priority: effective.length - idx, // highest success rate gets highest priority
  }));

  // Derive anti-patterns from ineffective strategies
  const antiPatterns = ineffective.map(
    (s) =>
      `Avoid "${s.strategy}" (${Math.round(s.successRate * 100)}% success rate across ${s.uses} uses)`
  );

  // Add anti-patterns from top failure types
  for (const ft of analysis.topFailureTypes.slice(0, 3)) {
    if (ft.rate > 0.3) {
      antiPatterns.push(
        `High failure rate for task type "${ft.type}" (${Math.round(ft.rate * 100)}% of runs)`
      );
    }
  }

  // Confidence scales with data volume: 10+ runs = 1.0, fewer = proportional
  const confidence = Math.min(1, analysis.totalRuns / 10);

  const strategy: DomainStrategy = {
    domain,
    approaches,
    antiPatterns,
    confidence,
    lastUpdated: new Date().toISOString(),
  };

  strategyCache.set(domain, strategy);
  return strategy;
}

/**
 * Retrieve a cached domain strategy, or undefined if not yet computed.
 */
export function getStrategyForDomain(
  domain: string
): DomainStrategy | undefined {
  return strategyCache.get(domain);
}

/**
 * Suggest the best approach for a domain given the current state description.
 * Returns the highest-priority approach whose conditions are satisfied,
 * or the top approach if no condition-based filtering applies.
 */
export function suggestApproach(
  domain: string,
  currentState: string
): StrategyApproach | undefined {
  const strategy = strategyCache.get(domain);
  if (!strategy || strategy.approaches.length === 0) {
    return undefined;
  }

  // Sort by priority descending
  const sorted = [...strategy.approaches].sort(
    (a, b) => b.priority - a.priority
  );

  // Try to match conditions against currentState
  const lower = currentState.toLowerCase();
  for (const approach of sorted) {
    const conditionsMatch = approach.conditions.some((c) => {
      // Simple keyword matching: check if any condition keyword appears in state
      const keyword = c.replace(/[^a-z_]/gi, "").toLowerCase();
      return keyword.length > 0 && lower.includes(keyword);
    });
    if (conditionsMatch) {
      return approach;
    }
  }

  // Fallback: return highest priority approach
  return sorted[0];
}

/**
 * Clear the strategy cache (useful for testing).
 */
export function clearStrategyCache(): void {
  strategyCache.clear();
}
