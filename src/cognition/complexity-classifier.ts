/**
 * Complexity Classifier — System 1 vs System 2 routing.
 *
 * Before execution starts, classify the goal's reasoning complexity
 * to actively choose fast (rule-based) or slow (LLM-deep) path.
 *
 * Heuristics-only (no LLM call) so this is itself System 1 —
 * it takes microseconds, not seconds.
 */

export type ReasoningMode = "fast" | "slow" | "hybrid";

export interface ComplexityAssessment {
  mode: ReasoningMode;
  score: number;           // 0=trivial, 1=deep reasoning needed
  signals: string[];       // Which heuristics fired
  suggestedExecutionMode: "sequential" | "react" | "cli";
  rationale: string;
}

// ── Signal detectors ────────────────────────────────────────────────────

const DSL_MARKERS = [
  /\bopen page\s+"/i,
  /\bhttp_request\s+"/i,
  /\brun_code\s+"/i,
  /\bread_file\s+"/i,
  /\bwrite_file\s+"/i,
  /\bclick\s+"/i,
  /\btype\s+"/i,
  /\bassert text\s+"/i,
  /\bscreenshot\b/i,
  /\bstart app\b/i,
  /\bstop app\b/i,
  /\bwait for server\b/i,
];

const REASONING_INDICATORS = [
  /\b(why|explain|analyze|compare|evaluate|reason|deduce|infer)\b/i,
  /\b(should I|which is better|what if|suppose|assume)\b/i,
  /\b(understand|interpret|determine|figure out|decide)\b/i,
  /\b(pattern|rule|relationship|connection)\b/i,
];

const MULTI_STEP_INDICATORS = [
  /\b(then|after|next|finally|first)\b/i,
  /\b(step by step|iterate|repeat until)\b/i,
  /\s+and\s+.+\s+and\s+/i,  // "do X and Y and Z"
];

const VAGUE_INDICATORS = [
  /\b(something|anything|whatever|somehow|maybe)\b/i,
  /\b(figure out|find out|work out|sort out)\b/i,
  /\b(interesting|useful|good|relevant|appropriate)\b/i,
];

const ABSTRACT_INDICATORS = [
  /\b(concept|principle|theory|abstraction|generalize)\b/i,
  /\b(hypothes|proof|theorem|lemma)\b/i,
];

const SHELL_INDICATORS = [
  /\b(ls|cd|grep|find|cat|awk|sed|git|npm|python|node|curl|pip)\b/i,
  /\b(shell|command|terminal|bash|cli)\b/i,
  /\b(file|directory|folder|process)\b/i,
];

// ── Classifier ─────────────────────────────────────────────────────────

export function classifyComplexity(goal: string): ComplexityAssessment {
  const trimmed = goal.trim();
  const signals: string[] = [];
  let score = 0;

  // DSL detection → always fast path
  const dslCount = DSL_MARKERS.filter(p => p.test(trimmed)).length;
  if (dslCount > 0) {
    signals.push(`dsl_markers:${dslCount}`);
    score -= 0.4;
  }

  // Reasoning indicators → slow path
  const reasoningCount = REASONING_INDICATORS.filter(p => p.test(trimmed)).length;
  if (reasoningCount > 0) {
    signals.push(`reasoning:${reasoningCount}`);
    score += 0.25 * reasoningCount;
  }

  // Multi-step → moderate complexity
  const multiStepCount = MULTI_STEP_INDICATORS.filter(p => p.test(trimmed)).length;
  if (multiStepCount > 0) {
    signals.push(`multi_step:${multiStepCount}`);
    score += 0.15 * multiStepCount;
  }

  // Vague language → needs LLM interpretation
  const vagueCount = VAGUE_INDICATORS.filter(p => p.test(trimmed)).length;
  if (vagueCount > 0) {
    signals.push(`vague:${vagueCount}`);
    score += 0.2 * vagueCount;
  }

  // Abstract concepts → deep reasoning
  const abstractCount = ABSTRACT_INDICATORS.filter(p => p.test(trimmed)).length;
  if (abstractCount > 0) {
    signals.push(`abstract:${abstractCount}`);
    score += 0.3 * abstractCount;
  }

  // Shell indicators → CLI mode (count total matches across all shell regexes)
  let shellCount = 0;
  for (const p of SHELL_INDICATORS) {
    const globalPattern = new RegExp(p.source, p.flags + (p.flags.includes("g") ? "" : "g"));
    const matches = trimmed.match(globalPattern);
    shellCount += matches?.length ?? 0;
  }
  const isShellTask = shellCount >= 2 && dslCount === 0;
  if (isShellTask) {
    signals.push(`shell:${shellCount}`);
  }

  // Length heuristic
  if (trimmed.length > 200) {
    signals.push("long_goal");
    score += 0.15;
  }
  if (trimmed.length < 30 && dslCount === 0) {
    signals.push("short_vague");
    score += 0.1;
  }

  // Normalize score to [0, 1]
  score = Math.max(0, Math.min(1, score + 0.3));  // baseline 0.3

  // Decide mode
  let mode: ReasoningMode;
  let suggestedExecutionMode: "sequential" | "react" | "cli";

  if (isShellTask) {
    mode = score > 0.5 ? "slow" : "fast";
    suggestedExecutionMode = "cli";
  } else if (dslCount >= 2 || score < 0.25) {
    mode = "fast";
    suggestedExecutionMode = "sequential";
  } else if (score > 0.6) {
    mode = "slow";
    suggestedExecutionMode = "react";
  } else {
    mode = "hybrid";
    suggestedExecutionMode = "sequential"; // try fast first, auto-escalate
  }

  const rationale = mode === "fast"
    ? `Fast path: ${dslCount > 0 ? "DSL detected" : "low complexity score"}`
    : mode === "slow"
      ? `Slow path: deep reasoning required (${signals.filter(s => !s.startsWith("dsl")).join(", ")})`
      : `Hybrid: start fast, auto-escalate if needed`;

  return { mode, score, signals, suggestedExecutionMode, rationale };
}

/**
 * Estimate rough token cost for a mode.
 * Used for cost/performance tradeoff.
 */
export function estimateModeCost(mode: "sequential" | "react" | "cli", goalLength: number): number {
  // Rough token estimate per mode
  if (mode === "sequential") return 200;           // Template/regex: minimal
  if (mode === "cli") return 500 + goalLength * 2; // One LLM call per step
  if (mode === "react") return 2000 + goalLength * 5; // Multiple LLM calls
  return 1000;
}
