/**
 * Working Memory — structured reasoning context maintained within a single run.
 *
 * Unlike episodeEvents (append-only log), working memory is a live, queryable
 * state that tracks:
 *   - Attention focus: what sub-goal or task chain the agent is pursuing
 *   - Reasoning stack: chain of decisions with rationale (why we're here)
 *   - Short-term facts: recent observations distilled into key-value pairs
 *   - Failure patterns: within-run accumulation of error signatures
 *
 * The task-pipeline consults working memory at each decision point.
 */

import type { AgentTask } from "../types";
import type { AgentObservation, CognitiveDecision, VerificationResult } from "./types";

// ── Types ───────────────────────────────────────────────────────────────

export interface AttentionFocus {
  /** Current high-level objective (may be a sub-goal) */
  currentObjective: string;
  /** Task chain that serves this objective */
  taskChain: string[];
  /** How many consecutive successes on this objective */
  momentum: number;
  /** Set when the agent switches focus */
  switchedAt?: string;
  /** Why focus switched */
  switchReason?: string;
}

export interface ReasoningEntry {
  taskId: string;
  decision: string;       // "continue" | "replan" | "retry" | "abort"
  rationale: string;
  confidence: number;
  timestamp: string;
}

export interface ShortTermFact {
  key: string;
  value: string;
  source: string;         // Which task/observation produced this
  timestamp: string;
  /** Auto-expire after N steps (default: 5) */
  ttlSteps: number;
  stepsRemaining: number;
}

export interface FailureSignature {
  taskType: string;
  errorPattern: string;   // Normalized error category
  count: number;
  lastTaskId: string;
  /** Suggested strategy shift when count exceeds threshold */
  suggestedShift?: string;
}

export interface WorkingMemory {
  focus: AttentionFocus;
  reasoningStack: ReasoningEntry[];
  facts: ShortTermFact[];
  failurePatterns: Map<string, FailureSignature>;
  /** Total steps executed since creation */
  stepCount: number;
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createWorkingMemory(goal: string): WorkingMemory {
  return {
    focus: {
      currentObjective: goal,
      taskChain: [],
      momentum: 0
    },
    reasoningStack: [],
    facts: [],
    failurePatterns: new Map(),
    stepCount: 0
  };
}

// ── Attention ───────────────────────────────────────────────────────────

/**
 * Update attention focus after a task completes.
 */
export function updateFocus(
  wm: WorkingMemory,
  task: AgentTask,
  success: boolean
): void {
  if (success) {
    wm.focus.momentum++;
    if (!wm.focus.taskChain.includes(task.id)) {
      wm.focus.taskChain.push(task.id);
    }
  } else {
    wm.focus.momentum = 0;
  }
}

/**
 * Switch attention to a new objective (e.g., after replan).
 */
export function switchFocus(
  wm: WorkingMemory,
  newObjective: string,
  reason: string
): void {
  wm.focus = {
    currentObjective: newObjective,
    taskChain: [],
    momentum: 0,
    switchedAt: new Date().toISOString(),
    switchReason: reason
  };
}

// ── Reasoning Stack ─────────────────────────────────────────────────────

/**
 * Record a decision in the reasoning stack.
 * Keeps last 20 entries to prevent unbounded growth.
 */
export function recordReasoning(
  wm: WorkingMemory,
  taskId: string,
  decision: string,
  rationale: string,
  confidence: number
): void {
  wm.reasoningStack.push({
    taskId,
    decision,
    rationale,
    confidence,
    timestamp: new Date().toISOString()
  });
  if (wm.reasoningStack.length > 20) {
    wm.reasoningStack.shift();
  }
}

/**
 * Get the last N reasoning entries for context injection.
 */
export function getRecentReasoning(wm: WorkingMemory, n: number = 5): ReasoningEntry[] {
  return wm.reasoningStack.slice(-n);
}

/**
 * Check if the agent has been making the same decision repeatedly (stuck pattern).
 */
export function detectReasoningLoop(wm: WorkingMemory, windowSize: number = 4): boolean {
  if (wm.reasoningStack.length < windowSize * 2) return false;
  const recent = wm.reasoningStack.slice(-windowSize);
  const prior = wm.reasoningStack.slice(-windowSize * 2, -windowSize);
  // Check if the decision pattern repeats
  return recent.every((r, i) =>
    r.decision === prior[i].decision && r.rationale === prior[i].rationale
  );
}

// ── Short-Term Facts ────────────────────────────────────────────────────

/**
 * Record a short-term fact from an observation.
 * Overwrites existing fact with the same key.
 */
export function recordFact(
  wm: WorkingMemory,
  key: string,
  value: string,
  source: string,
  ttlSteps: number = 5
): void {
  const existing = wm.facts.findIndex(f => f.key === key);
  const fact: ShortTermFact = {
    key,
    value,
    source,
    timestamp: new Date().toISOString(),
    ttlSteps,
    stepsRemaining: ttlSteps
  };
  if (existing >= 0) {
    wm.facts[existing] = fact;
  } else {
    wm.facts.push(fact);
  }
}

/**
 * Get a fact by key, or undefined if expired/not set.
 */
export function getFact(wm: WorkingMemory, key: string): string | undefined {
  const fact = wm.facts.find(f => f.key === key && f.stepsRemaining > 0);
  return fact?.value;
}

/**
 * Get all live facts as a key-value record.
 */
export function getAllFacts(wm: WorkingMemory): Record<string, string> {
  const result: Record<string, string> = {};
  for (const fact of wm.facts) {
    if (fact.stepsRemaining > 0) {
      result[fact.key] = fact.value;
    }
  }
  return result;
}

/**
 * Age all facts by one step. Remove expired ones.
 */
export function tickFacts(wm: WorkingMemory): void {
  for (const fact of wm.facts) {
    fact.stepsRemaining--;
  }
  wm.facts = wm.facts.filter(f => f.stepsRemaining > 0);
}

/**
 * Extract and record key facts from an observation.
 */
export function recordObservationFacts(
  wm: WorkingMemory,
  observation: AgentObservation,
  taskId: string
): void {
  if (observation.pageUrl) {
    recordFact(wm, "currentUrl", observation.pageUrl, taskId);
  }
  if (observation.appStateGuess) {
    recordFact(wm, "appState", observation.appStateGuess, taskId);
  }
  if (observation.title) {
    recordFact(wm, "pageTitle", observation.title, taskId);
  }
  const elementCount = observation.actionableElements?.length ?? 0;
  recordFact(wm, "elementCount", String(elementCount), taskId, 3);
}

// ── Failure Pattern Accumulation ────────────────────────────────────────

/**
 * Record a task failure and accumulate pattern counts.
 */
export function recordFailurePattern(
  wm: WorkingMemory,
  task: AgentTask,
  errorMessage: string
): void {
  const pattern = normalizeErrorPattern(errorMessage);
  const key = `${task.type}:${pattern}`;
  const existing = wm.failurePatterns.get(key);

  if (existing) {
    existing.count++;
    existing.lastTaskId = task.id;
    existing.suggestedShift = suggestStrategyShift(task.type, pattern, existing.count);
  } else {
    wm.failurePatterns.set(key, {
      taskType: task.type,
      errorPattern: pattern,
      count: 1,
      lastTaskId: task.id,
      suggestedShift: undefined
    });
  }
}

/**
 * Get accumulated failure patterns, sorted by count descending.
 */
export function getFailurePatterns(wm: WorkingMemory): FailureSignature[] {
  return Array.from(wm.failurePatterns.values())
    .sort((a, b) => b.count - a.count);
}

/**
 * Check if a specific failure pattern has exceeded a threshold.
 */
export function isPatternExceeded(
  wm: WorkingMemory,
  taskType: string,
  threshold: number = 3
): FailureSignature | undefined {
  for (const sig of wm.failurePatterns.values()) {
    if (sig.taskType === taskType && sig.count >= threshold) {
      return sig;
    }
  }
  return undefined;
}

/**
 * Step the working memory: age facts, increment step counter.
 */
export function stepWorkingMemory(wm: WorkingMemory): void {
  wm.stepCount++;
  tickFacts(wm);
}

// ── Internals ───────────────────────────────────────────────────────────

function normalizeErrorPattern(error: string): string {
  if (/selector|locator|not found|no node/i.test(error)) return "selector_miss";
  if (/timeout|timed out/i.test(error)) return "timeout";
  if (/assert|expected text/i.test(error)) return "assertion_fail";
  if (/navigation|net::/i.test(error)) return "navigation_error";
  if (/login|sign in|auth/i.test(error)) return "auth_issue";
  return "other";
}

function suggestStrategyShift(taskType: string, pattern: string, count: number): string | undefined {
  if (pattern === "selector_miss" && count >= 2) {
    return "switch_to_visual";
  }
  if (pattern === "timeout" && count >= 3) {
    return "increase_wait_time";
  }
  if (pattern === "assertion_fail" && count >= 2) {
    return "relax_assertion";
  }
  if (pattern === "auth_issue" && count >= 2) {
    return "retry_login_flow";
  }
  return undefined;
}
