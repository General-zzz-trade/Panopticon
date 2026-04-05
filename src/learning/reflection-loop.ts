/**
 * Reflection Loop — periodic statistical analysis of failure patterns.
 * Computes which hypothesis kinds resolve failures most often,
 * which task types fail most, and generates adjustment recommendations.
 */

import { getLessonsForTaskType, getKnowledgeStats } from "../knowledge/store";
import type { FailureHypothesisKind } from "../cognition/types";
import { logModuleError } from "../core/module-logger";

export interface ReflectionInsight {
  hypothesisSuccessRates: Record<string, number>;  // kind → success rate
  taskTypeFailureRates: Record<string, number>;    // taskType → failure rate
  dominantRecoveryStrategies: Array<{ strategy: string; successCount: number }>;
  recommendations: string[];
}

/**
 * Analyze failure lessons across all task types and produce insights.
 */
export function runReflection(): ReflectionInsight {
  const taskTypes = ["click", "type", "assert_text", "select", "hover", "open_page", "visual_click", "visual_type"];

  const allLessons: Array<{
    taskType: string;
    recovery: string;
    successCount: number;
    hypothesisKind?: string;
  }> = [];

  for (const taskType of taskTypes) {
    try {
      const lessons = getLessonsForTaskType(taskType);
      for (const lesson of lessons) {
        allLessons.push({
          taskType: lesson.taskType,
          recovery: lesson.recovery,
          successCount: lesson.successCount,
          hypothesisKind: lesson.hypothesisKind
        });
      }
    } catch (error) {
      logModuleError("reflection-loop", "optional", error, `Failed to get lessons for task type "${taskType}"`);
    }
  }

  // Compute hypothesis success rates
  const hypothesisSuccessRates = computeHypothesisSuccessRates(allLessons);

  // Compute task type failure rates (lessons = failures that were recovered)
  const taskTypeFailureRates = computeTaskTypeFailureRates(allLessons);

  // Find dominant recovery strategies
  const dominantRecoveryStrategies = findDominantStrategies(allLessons);

  // Generate recommendations
  const recommendations = generateRecommendations(
    hypothesisSuccessRates,
    taskTypeFailureRates,
    dominantRecoveryStrategies
  );

  return {
    hypothesisSuccessRates,
    taskTypeFailureRates,
    dominantRecoveryStrategies,
    recommendations
  };
}

function computeHypothesisSuccessRates(
  lessons: Array<{ hypothesisKind?: string; successCount: number }>
): Record<string, number> {
  const grouped = new Map<string, { total: number; successes: number }>();

  for (const lesson of lessons) {
    const kind = lesson.hypothesisKind ?? "unknown";
    const entry = grouped.get(kind) ?? { total: 0, successes: 0 };
    entry.total += 1;
    entry.successes += lesson.successCount;
    grouped.set(kind, entry);
  }

  const rates: Record<string, number> = {};
  for (const [kind, { total, successes }] of grouped) {
    rates[kind] = total > 0 ? Math.min(1, successes / Math.max(1, total)) : 0;
  }
  return rates;
}

function computeTaskTypeFailureRates(
  lessons: Array<{ taskType: string; successCount: number }>
): Record<string, number> {
  const grouped = new Map<string, { total: number; recovered: number }>();

  for (const lesson of lessons) {
    const entry = grouped.get(lesson.taskType) ?? { total: 0, recovered: 0 };
    entry.total += 1;
    if (lesson.successCount > 0) entry.recovered += 1;
    grouped.set(lesson.taskType, entry);
  }

  const rates: Record<string, number> = {};
  for (const [type, { total, recovered }] of grouped) {
    // Failure rate = proportion of lessons (higher = more failures seen)
    rates[type] = total;
  }
  return rates;
}

function findDominantStrategies(
  lessons: Array<{ recovery: string; successCount: number }>
): Array<{ strategy: string; successCount: number }> {
  const strategyMap = new Map<string, number>();

  for (const lesson of lessons) {
    const current = strategyMap.get(lesson.recovery) ?? 0;
    strategyMap.set(lesson.recovery, current + lesson.successCount);
  }

  return Array.from(strategyMap.entries())
    .map(([strategy, successCount]) => ({ strategy, successCount }))
    .sort((a, b) => b.successCount - a.successCount)
    .slice(0, 10);
}

function generateRecommendations(
  hypothesisRates: Record<string, number>,
  taskTypeRates: Record<string, number>,
  strategies: Array<{ strategy: string; successCount: number }>
): string[] {
  const recs: string[] = [];

  // Recommend boosting high-success hypothesis kinds
  for (const [kind, rate] of Object.entries(hypothesisRates)) {
    if (rate >= 3) {
      recs.push(`Boost prior for "${kind}" hypothesis — ${rate} successful recoveries recorded.`);
    }
  }

  // Recommend defensive measures for high-failure task types
  for (const [type, count] of Object.entries(taskTypeRates)) {
    if (count >= 5) {
      recs.push(`Task type "${type}" has ${count} recorded failure lessons — consider adding defensive wait or visual fallback.`);
    }
  }

  // Recommend applying dominant strategies
  for (const { strategy, successCount } of strategies) {
    if (successCount >= 3) {
      recs.push(`Strategy "${strategy}" succeeded ${successCount} times — consider auto-applying.`);
    }
  }

  return recs;
}

/**
 * Compute adjusted prior confidence for a hypothesis kind
 * based on historical success rates.
 */
export function getAdjustedPrior(
  kind: FailureHypothesisKind,
  baseConfidence: number,
  insight: ReflectionInsight
): number {
  const rate = insight.hypothesisSuccessRates[kind];
  if (rate === undefined || rate === 0) return baseConfidence;

  // Blend base confidence with learned rate
  // More data (higher rate) → more weight on learned value
  const learnedWeight = Math.min(0.5, rate * 0.1);  // max 50% influence
  const adjustedBase = 0.5 + rate * 0.05;            // map success count to [0.5, 1.0]
  return baseConfidence * (1 - learnedWeight) + Math.min(0.9, adjustedBase) * learnedWeight;
}
