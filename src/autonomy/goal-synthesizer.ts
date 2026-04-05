/**
 * Goal Synthesizer — turns environment triggers into executable agent goals.
 *
 * Maps trigger events (file changes, HTTP status, new messages, etc.)
 * to specific goals the agent should pursue autonomously.
 */

import type { Trigger } from "./environment-watcher";

export interface SynthesisRule {
  /** Matches against trigger.type */
  triggerType: string;
  /** Optional filter on trigger.data */
  filter?: (trigger: Trigger) => boolean;
  /** Turns a trigger into a goal string */
  synthesize: (trigger: Trigger) => string;
  /** Execution mode to use */
  mode?: "sequential" | "react" | "cli";
  /** Priority — higher runs first if multiple rules match */
  priority?: number;
}

const rules: SynthesisRule[] = [];

/**
 * Register a synthesis rule.
 */
export function registerRule(rule: SynthesisRule): void {
  rules.push(rule);
  rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/**
 * Clear all rules.
 */
export function clearRules(): void {
  rules.length = 0;
}

/**
 * Synthesize a goal from a trigger, or null if no rule matches.
 */
export function synthesizeGoal(trigger: Trigger): { goal: string; mode?: string } | null {
  for (const rule of rules) {
    if (rule.triggerType !== trigger.type) continue;
    if (rule.filter && !rule.filter(trigger)) continue;
    return { goal: rule.synthesize(trigger), mode: rule.mode };
  }
  return null;
}

/**
 * List all registered rules.
 */
export function listRules(): SynthesisRule[] {
  return [...rules];
}

// ── Default rules ───────────────────────────────────────────────────────

/**
 * Register common default rules.
 */
export function registerDefaultRules(): void {
  // File changed → analyze it
  registerRule({
    triggerType: "file_changed",
    synthesize: (t) => `read the file ${t.data.path} and summarize what changed`,
    mode: "cli"
  });

  // New files in directory → process them
  registerRule({
    triggerType: "new_files",
    synthesize: (t) => {
      const files = (t.data.files as string[]).slice(0, 3).join(", ");
      return `list the new files in ${t.data.path}: ${files}`;
    },
    mode: "cli"
  });

  // HTTP status changed → investigate
  registerRule({
    triggerType: "http_status_changed",
    synthesize: (t) => `check ${t.data.url} — status changed to ${t.data.status}, report what happened`,
    mode: "react"
  });

  // HTTP content changed → summarize
  registerRule({
    triggerType: "http_content_changed",
    synthesize: (t) => `go to ${t.data.url} and tell me what's new on the page`,
    mode: "react"
  });
}
