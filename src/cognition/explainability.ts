/**
 * Explainability — generates human-readable explanations for agent decisions.
 *
 * Given a reasoning trace entry, produces a structured explanation:
 * "I chose to [action] because [reason], after considering [alternatives].
 *  The key factors were: [context summary]."
 */

import type { ReasoningTrace, ReasoningTraceEntry, DecisionOption } from "./reasoning-trace";
import { getTraceForTask, getDecisionChain, getReplans } from "./reasoning-trace";

export interface Explanation {
  taskId: string;
  taskType: string;
  stepIndex: number;
  /** One-sentence summary */
  summary: string;
  /** What was chosen and why */
  decision: string;
  /** What alternatives existed */
  alternatives: string[];
  /** Key context that influenced the decision */
  keyFactors: string[];
  /** Full reasoning chain leading to this point */
  priorDecisions: string[];
}

/**
 * Explain why a specific decision was made for a task.
 */
export function explainDecision(trace: ReasoningTrace, taskId: string): Explanation | undefined {
  const entry = getTraceForTask(trace, taskId);
  if (!entry) return undefined;

  return buildExplanation(entry, trace);
}

/**
 * Explain the overall run: why it succeeded or failed.
 */
export function explainRun(trace: ReasoningTrace): string {
  if (trace.entries.length === 0) return "No decisions were recorded for this run.";

  const replans = getReplans(trace);
  const lastEntry = trace.entries[trace.entries.length - 1];
  const totalSteps = trace.entries.length;

  const lines: string[] = [];
  lines.push(`Executed ${totalSteps} decision points.`);

  if (replans.length > 0) {
    lines.push(`Replanned ${replans.length} time(s):`);
    for (const r of replans) {
      lines.push(`  - Step ${r.stepIndex} (${r.taskType}): ${r.chosen.rationale}`);
    }
  }

  // Identify the dominant failure pattern if any
  const failedHypotheses = trace.entries
    .flatMap(e => e.context.activeHypotheses)
    .filter(h => h.confidence > 0.5);

  if (failedHypotheses.length > 0) {
    const counts = new Map<string, number>();
    for (const h of failedHypotheses) {
      counts.set(h.kind, (counts.get(h.kind) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    lines.push(`Dominant failure hypothesis: ${sorted[0][0]} (appeared ${sorted[0][1]} times)`);
  }

  // Lookahead impact
  const lookaheadEntries = trace.entries.filter(e => e.context.lookahead);
  if (lookaheadEntries.length > 0) {
    const avgConfidence = lookaheadEntries.reduce((s, e) => s + (e.context.lookahead?.overallConfidence ?? 0), 0) / lookaheadEntries.length;
    lines.push(`Lookahead was active at ${lookaheadEntries.length} steps (avg confidence: ${(avgConfidence * 100).toFixed(0)}%)`);
  }

  lines.push(`Final decision: ${lastEntry.chosen.action} — ${lastEntry.chosen.rationale}`);

  return lines.join("\n");
}

/**
 * Get a brief explanation suitable for API responses.
 */
export function explainBrief(trace: ReasoningTrace, taskId: string): string {
  const entry = getTraceForTask(trace, taskId);
  if (!entry) return "No reasoning trace found for this task.";

  const chosen = entry.chosen;
  const topAlternative = entry.options.find(o => o.action !== chosen.action);
  const ctx = entry.context;

  let explanation = `Chose "${chosen.action}" (confidence: ${(entry.confidence * 100).toFixed(0)}%). `;
  explanation += chosen.rationale + ". ";

  if (topAlternative) {
    explanation += `Alternative was "${topAlternative.action}" (score: ${(topAlternative.score * 100).toFixed(0)}%). `;
  }

  if (ctx.activeHypotheses.length > 0) {
    const topH = ctx.activeHypotheses[0];
    explanation += `Top hypothesis: ${topH.kind} (${(topH.confidence * 100).toFixed(0)}%). `;
  }

  if (ctx.lookahead) {
    explanation += `Lookahead (${ctx.lookahead.horizon} steps): ${(ctx.lookahead.overallConfidence * 100).toFixed(0)}% confidence.`;
  }

  return explanation;
}

// ── Internal ────────────────────────────────────────────────────────────

function buildExplanation(entry: ReasoningTraceEntry, trace: ReasoningTrace): Explanation {
  const chosen = entry.chosen;
  const alternatives = entry.options
    .filter(o => o.action !== chosen.action)
    .map(o => `${o.action} (score: ${(o.score * 100).toFixed(0)}%) — ${o.rationale}`);

  const keyFactors: string[] = [];

  // Observation state
  const obs = entry.context.observedState;
  if (obs.pageUrl) keyFactors.push(`Current page: ${obs.pageUrl}`);
  if (obs.appState) keyFactors.push(`App state: ${obs.appState}`);
  if (obs.anomalyCount && obs.anomalyCount > 0) keyFactors.push(`${obs.anomalyCount} anomalies detected`);

  // Verifications
  const failedVerifications = entry.context.verifications.filter(v => !v.passed);
  if (failedVerifications.length > 0) {
    keyFactors.push(`Failed verifications: ${failedVerifications.map(v => v.verifier).join(", ")}`);
  }

  // Hypotheses
  for (const h of entry.context.activeHypotheses) {
    keyFactors.push(`Hypothesis: ${h.kind} (${(h.confidence * 100).toFixed(0)}%)`);
  }

  // Lookahead
  if (entry.context.lookahead) {
    keyFactors.push(`Lookahead: ${(entry.context.lookahead.overallConfidence * 100).toFixed(0)}% confidence over ${entry.context.lookahead.horizon} steps`);
  }

  // Working memory
  if (entry.context.workingMemory) {
    const wm = entry.context.workingMemory;
    if (wm.momentum > 0) keyFactors.push(`Momentum: ${wm.momentum} consecutive successes`);
    if (wm.dominantPattern) keyFactors.push(`Dominant failure: ${wm.dominantPattern}`);
  }

  // Prior decisions
  const chain = getDecisionChain(trace, entry.stepIndex - 1);
  const priorDecisions = chain.slice(-3).map(e =>
    `Step ${e.stepIndex}: ${e.chosen.action} on ${e.taskType} (${(e.confidence * 100).toFixed(0)}%)`
  );

  return {
    taskId: entry.taskId,
    taskType: entry.taskType,
    stepIndex: entry.stepIndex,
    summary: `At step ${entry.stepIndex}, chose to ${chosen.action} on ${entry.taskType} with ${(entry.confidence * 100).toFixed(0)}% confidence.`,
    decision: `${chosen.action}: ${chosen.rationale}`,
    alternatives,
    keyFactors,
    priorDecisions
  };
}
