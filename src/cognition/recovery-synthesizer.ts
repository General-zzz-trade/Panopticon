/**
 * Recovery Synthesizer — generates new recovery programs via LLM
 * when predefined strategies fail.
 *
 * Based on: Voyager (NeurIPS 2023) skill library pattern.
 *
 * Flow:
 * 1. Collect failure context (state, error, previous attempts)
 * 2. Ask LLM to generate a recovery task sequence
 * 3. Validate the sequence (all task types must be known)
 * 4. If validated, return for execution
 * 5. If execution succeeds, persist to skill library
 */

import type { AgentTask, RunContext } from "../types";
import type { RecoveryProgram } from "./types";
import { readProviderConfig, callOpenAICompatible, callAnthropic, safeJsonParse } from "../llm/provider";
import { logModuleError } from "../core/module-logger";

const ALLOWED_RECOVERY_TYPES = new Set([
  "click", "type", "select", "scroll", "hover", "wait",
  "open_page", "assert_text", "screenshot",
  "visual_click", "visual_type"
]);

// In-memory skill library (can be persisted to knowledge store)
const skillLibrary: RecoveryProgram[] = [];

/**
 * Attempt to synthesize a recovery program via LLM.
 * Returns null if no LLM is configured or synthesis fails.
 */
export async function synthesizeRecovery(input: {
  context: RunContext;
  task: AgentTask;
  error: string;
  previousAttempts: string[];
}): Promise<RecoveryProgram | null> {
  // First check skill library for existing programs
  const existing = findMatchingProgram(input.error);
  if (existing) return existing;

  const config = readProviderConfig("LLM_RECOVERY", { maxTokens: 500 });
  if (!config.provider || !config.apiKey) return null;

  const prompt = buildSynthesisPrompt(input);

  try {
    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: prompt }
    ];

    const result = config.provider === "anthropic"
      ? await callAnthropic(config, messages, "RecoverySynthesizer")
      : await callOpenAICompatible(config, messages, "RecoverySynthesizer");

    const parsed = safeJsonParse(result.content);
    if (!parsed || !Array.isArray((parsed as { steps?: unknown }).steps)) return null;

    const steps = (parsed as { steps: Array<{ type: string; payload: Record<string, unknown> }> }).steps;

    // Validate all task types
    const valid = steps.every(s => ALLOWED_RECOVERY_TYPES.has(s.type));
    if (!valid || steps.length === 0 || steps.length > 10) return null;

    const program: RecoveryProgram = {
      id: `rp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      triggerPattern: extractErrorPattern(input.error),
      steps,
      successCount: 0,
      failureCount: 0,
      createdAt: new Date().toISOString()
    };

    return program;
  } catch (error) {
    logModuleError("recovery-synthesizer", "optional", error, "synthesizing recovery program via LLM");
    return null;
  }
}

/**
 * Record the outcome of a synthesized recovery program.
 * If successful, add to skill library for future reuse.
 */
export function recordRecoveryOutcome(program: RecoveryProgram, success: boolean): void {
  if (success) {
    program.successCount += 1;
    // Add to library if not already present
    if (!skillLibrary.some(p => p.id === program.id)) {
      skillLibrary.push(program);
    }
  } else {
    program.failureCount += 1;
  }

  // Prune poorly-performing programs
  pruneSkillLibrary();
}

/**
 * Convert a RecoveryProgram into executable AgentTasks.
 */
export function programToTasks(program: RecoveryProgram, baseTaskId: string): AgentTask[] {
  return program.steps.map((step, i) => ({
    id: `${baseTaskId}-recovery-${i}`,
    type: step.type as AgentTask["type"],
    status: "pending" as const,
    retries: 0,
    attempts: 0,
    replanDepth: 0,
    payload: step.payload as Record<string, string | number | boolean | undefined>
  }));
}

export function getSkillLibrary(): RecoveryProgram[] {
  return [...skillLibrary];
}

export function resetSkillLibrary(): void {
  skillLibrary.length = 0;
}

export function restoreSkillLibrary(programs: RecoveryProgram[]): void {
  skillLibrary.length = 0;
  skillLibrary.push(...programs);
}

function findMatchingProgram(error: string): RecoveryProgram | null {
  const errorLower = error.toLowerCase();
  for (const program of skillLibrary) {
    if (program.successCount <= program.failureCount) continue; // skip unreliable
    if (errorLower.includes(program.triggerPattern.toLowerCase())) {
      return program;
    }
  }
  return null;
}

function extractErrorPattern(error: string): string {
  // Extract the first meaningful phrase from the error
  const match = error.match(/^[\w\s]+(?=:|\(|$)/);
  return match?.[0]?.trim().slice(0, 50) ?? error.slice(0, 50);
}

function pruneSkillLibrary(): void {
  // Remove programs with >3 failures and <30% success rate
  for (let i = skillLibrary.length - 1; i >= 0; i--) {
    const p = skillLibrary[i];
    const total = p.successCount + p.failureCount;
    if (total >= 4 && p.successCount / total < 0.3) {
      skillLibrary.splice(i, 1);
    }
  }
}

function buildSynthesisPrompt(input: {
  context: RunContext;
  task: AgentTask;
  error: string;
  previousAttempts: string[];
}): string {
  const pageUrl = input.context.worldState?.pageUrl ?? "unknown";
  const appState = input.context.worldState?.appState ?? "unknown";
  const visibleText = input.context.latestObservation?.visibleText?.slice(0, 5).join(" ") ?? "";

  return `Task failed and needs recovery.

Task: ${input.task.type} ${JSON.stringify(input.task.payload)}
Error: ${input.error}
Page URL: ${pageUrl}
App state: ${appState}
Visible text: ${visibleText}
Previous attempts: ${input.previousAttempts.join("; ") || "none"}

Generate a recovery sequence of 1-5 steps. Each step must be one of: ${Array.from(ALLOWED_RECOVERY_TYPES).join(", ")}.

Respond as JSON: { "steps": [{ "type": "...", "payload": { ... } }] }`;
}

const SYSTEM_PROMPT = `You are a recovery strategy synthesizer for OSINT investigations.
Generate minimal, targeted recovery steps to resolve task failures.
Only use allowed task types. Keep sequences short (1-5 steps).
Respond ONLY with valid JSON, no explanation.`;
