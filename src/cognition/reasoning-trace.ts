/**
 * Reasoning Trace — structured decision recording at every choice point.
 *
 * Unlike working memory (rolling window) or episode events (append-only log),
 * the reasoning trace captures the FULL decision context: what data was available,
 * what options were considered, how each was scored, and why one was chosen.
 *
 * This enables post-hoc explainability: "why did you replan at step 5?"
 */

import type { AgentTask } from "../types";
import type { VerificationResult, CognitiveDecision, FailureHypothesis } from "./types";

// ── Types ───────────────────────────────────────────────────────────────

export interface DecisionOption {
  action: string;         // "continue" | "replan" | "retry" | "abort" | "ask_user"
  score: number;          // 0-1, how good this option was rated
  rationale: string;      // Why this score
}

export interface DecisionContext {
  /** What observation data was available */
  observedState: {
    pageUrl?: string;
    appState?: string;
    visibleTextSnippet?: string;
    elementCount?: number;
    anomalyCount?: number;
  };
  /** Verification results that informed this decision */
  verifications: Array<{
    verifier: string;
    passed: boolean;
    confidence: number;
  }>;
  /** Active hypotheses at decision time */
  activeHypotheses: Array<{
    kind: string;
    confidence: number;
  }>;
  /** Lookahead predictions (if lookahead was run) */
  lookahead?: {
    horizon: number;
    overallConfidence: number;
    suggestedAction: string;
  };
  /** Working memory state */
  workingMemory?: {
    momentum: number;
    failurePatternCount: number;
    dominantPattern?: string;
    factCount: number;
  };
}

export interface ReasoningTraceEntry {
  id: string;
  runId: string;
  taskId: string;
  taskType: string;
  stepIndex: number;
  timestamp: string;
  /** Full context at decision time */
  context: DecisionContext;
  /** All options that were considered */
  options: DecisionOption[];
  /** Which option was chosen */
  chosen: DecisionOption;
  /** Confidence in the decision */
  confidence: number;
  /** Was this decision later validated as correct? (set post-hoc) */
  validated?: boolean;
}

export interface ReasoningTrace {
  runId: string;
  entries: ReasoningTraceEntry[];
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createReasoningTrace(runId: string): ReasoningTrace {
  return { runId, entries: [] };
}

// ── Recording ───────────────────────────────────────────────────────────

/**
 * Record a decision with full context.
 */
export function recordDecisionTrace(
  trace: ReasoningTrace,
  input: {
    taskId: string;
    taskType: string;
    stepIndex: number;
    context: DecisionContext;
    options: DecisionOption[];
    chosen: DecisionOption;
    confidence: number;
  }
): ReasoningTraceEntry {
  const entry: ReasoningTraceEntry = {
    id: `trace-${trace.runId}-${trace.entries.length}`,
    runId: trace.runId,
    taskId: input.taskId,
    taskType: input.taskType,
    stepIndex: input.stepIndex,
    timestamp: new Date().toISOString(),
    context: input.context,
    options: input.options,
    chosen: input.chosen,
    confidence: input.confidence
  };
  trace.entries.push(entry);
  return entry;
}

/**
 * Build decision context from available runtime state.
 */
export function buildDecisionContext(input: {
  pageUrl?: string;
  appState?: string;
  visibleText?: string[];
  elementCount?: number;
  anomalyCount?: number;
  verifications?: VerificationResult[];
  hypotheses?: FailureHypothesis[];
  lookahead?: { horizon: number; overallConfidence: number; suggestedAction: string };
  momentum?: number;
  failurePatternCount?: number;
  dominantPattern?: string;
  factCount?: number;
}): DecisionContext {
  return {
    observedState: {
      pageUrl: input.pageUrl,
      appState: input.appState,
      visibleTextSnippet: input.visibleText?.slice(0, 3).join(" ").slice(0, 200),
      elementCount: input.elementCount,
      anomalyCount: input.anomalyCount
    },
    verifications: (input.verifications ?? []).map(v => ({
      verifier: v.verifier,
      passed: v.passed,
      confidence: v.confidence
    })),
    activeHypotheses: (input.hypotheses ?? []).map(h => ({
      kind: h.kind,
      confidence: h.confidence
    })),
    lookahead: input.lookahead,
    workingMemory: (input.momentum !== undefined || input.failurePatternCount !== undefined) ? {
      momentum: input.momentum ?? 0,
      failurePatternCount: input.failurePatternCount ?? 0,
      dominantPattern: input.dominantPattern,
      factCount: input.factCount ?? 0
    } : undefined
  };
}

/**
 * Build decision options from a cognitive decision.
 * In the current architecture, the executive controller returns a single decision.
 * This function reconstructs what alternatives existed.
 */
export function buildDecisionOptions(
  decision: CognitiveDecision,
  verificationPassed: boolean,
  replanBudgetRemaining: number
): DecisionOption[] {
  const options: DecisionOption[] = [];

  // Continue is always an option
  options.push({
    action: "continue",
    score: verificationPassed ? 0.8 : 0.3,
    rationale: verificationPassed ? "Verification passed, continue execution" : "Verification failed but could continue"
  });

  // Replan is an option if budget allows
  if (replanBudgetRemaining > 0) {
    options.push({
      action: "replan",
      score: verificationPassed ? 0.2 : 0.6,
      rationale: verificationPassed
        ? "Could replan but not needed"
        : `Verification failed, ${replanBudgetRemaining} replans remaining`
    });
  }

  // Retry is an option
  options.push({
    action: "retry_task",
    score: verificationPassed ? 0.1 : 0.4,
    rationale: verificationPassed ? "No need to retry" : "Could retry the failed task"
  });

  // Abort is always an option
  options.push({
    action: "abort",
    score: replanBudgetRemaining <= 0 && !verificationPassed ? 0.7 : 0.05,
    rationale: replanBudgetRemaining <= 0 && !verificationPassed
      ? "No replans remaining and verification failed"
      : "Abort is a last resort"
  });

  // Mark the chosen one
  const chosen = options.find(o => o.action === decision.nextAction);
  if (chosen) {
    chosen.score = decision.confidence;
    chosen.rationale = decision.rationale;
  }

  return options.sort((a, b) => b.score - a.score);
}

// ── Querying ────────────────────────────────────────────────────────────

/**
 * Get the trace entry for a specific task.
 */
export function getTraceForTask(trace: ReasoningTrace, taskId: string): ReasoningTraceEntry | undefined {
  return trace.entries.find(e => e.taskId === taskId);
}

/**
 * Get all trace entries where a replan was chosen.
 */
export function getReplans(trace: ReasoningTrace): ReasoningTraceEntry[] {
  return trace.entries.filter(e => e.chosen.action === "replan" || e.chosen.action === "retry_task");
}

/**
 * Get the decision chain leading to a specific step.
 */
export function getDecisionChain(trace: ReasoningTrace, upToStep: number): ReasoningTraceEntry[] {
  return trace.entries.filter(e => e.stepIndex <= upToStep);
}
