/**
 * Self-Improving Agent (Karpathy's autoresearch pattern).
 *
 * The agent maintains a `program.md` file that acts as its own operating manual
 * (strategies, rules, heuristics). Each generation:
 *   1. Run evaluation tasks with current program.md injected as context.
 *   2. Score performance (success rate).
 *   3. Propose an edit to program.md (via LLM in react mode).
 *   4. Re-evaluate with the edited program.
 *   5. Keep the edit if the score improved, otherwise revert.
 *
 * The framework itself requires no LLM — it orchestrates runGoal executions.
 * Only the edit-proposal step invokes the LLM (via runGoal react mode).
 */

import * as fs from "fs";
import * as path from "path";
import { runGoal } from "../core/runtime";
import { logModuleError } from "../core/module-logger";

export interface TaskResult {
  taskGoal: string;
  success: boolean;
  durationMs: number;
}

export interface Generation {
  number: number;
  programContent: string;
  taskResults: TaskResult[];
  /** Average success rate (0..1) or custom metric. */
  score: number;
  proposedEdit?: string;
  editAccepted: boolean;
  createdAt: string;
}

export interface SelfImprovingOptions {
  /** Initial program.md content. */
  initialProgram: string;
  /** Test tasks used to evaluate each generation. */
  evaluationTasks: string[];
  /** Max generations to run (including generation 0). */
  maxGenerations: number;
  /** Path to persist program.md (default: ./program.md). */
  programPath?: string;
  /** Called after each generation is complete. */
  onGeneration?: (gen: Generation) => void;
  /** Tenant id for runGoal calls. */
  tenantId?: string;
}

export interface SelfImprovingResult {
  initialScore: number;
  finalScore: number;
  improvement: number;
  generations: Generation[];
  finalProgram: string;
}

const DEFAULT_PROGRAM_PATH = "program.md";

// --- Helpers -----------------------------------------------------------------

export function loadProgram(programPath: string): string {
  if (!fs.existsSync(programPath)) {
    return "";
  }
  return fs.readFileSync(programPath, "utf8");
}

export function saveProgram(programPath: string, content: string): void {
  const dir = path.dirname(programPath);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(programPath, content, "utf8");
}

export function getDefaultProgram(): string {
  return [
    "# Agent Operating Manual",
    "",
    "## Strategies",
    "- Read the task carefully before acting.",
    "- Prefer small, verifiable steps over large, speculative ones.",
    "- When uncertain, observe state first, then act.",
    "",
    "## Rules",
    "- Never skip verification.",
    "- Respect budgets; prefer cheap plans first.",
    "- If a step fails twice, replan rather than retry blindly.",
    "",
    "## Heuristics",
    "- Stable selectors beat visual selectors when both exist.",
    "- Re-read error messages literally; they often name the fix.",
    ""
  ].join("\n");
}

/** Compose the goal with the program.md content prepended as strategy context. */
export function composeGoalWithProgram(program: string, taskGoal: string): string {
  const trimmed = program.trim();
  if (!trimmed) return taskGoal;
  return `Following these strategies:\n${trimmed}\n\nTask: ${taskGoal}`;
}

// --- Core evaluation ---------------------------------------------------------

/** Run one task and return a TaskResult. Never throws. */
async function runOneTask(
  program: string,
  taskGoal: string,
  tenantId?: string
): Promise<TaskResult> {
  const startedAt = Date.now();
  const composed = composeGoalWithProgram(program, taskGoal);
  try {
    const ctx = await runGoal(composed, { tenantId });
    const success = ctx.result?.success === true;
    return { taskGoal, success, durationMs: Date.now() - startedAt };
  } catch (err) {
    logModuleError("self-improving", "optional", err, `runOneTask: ${taskGoal}`);
    return { taskGoal, success: false, durationMs: Date.now() - startedAt };
  }
}

/** Run all evaluation tasks with the given program and return results + score. */
export async function evaluateGeneration(
  program: string,
  tasks: string[],
  tenantId?: string
): Promise<{ results: TaskResult[]; score: number }> {
  const results: TaskResult[] = [];
  for (const taskGoal of tasks) {
    const r = await runOneTask(program, taskGoal, tenantId);
    results.push(r);
  }
  const score = computeScore(results);
  return { results, score };
}

export function computeScore(results: TaskResult[]): number {
  if (results.length === 0) return 0;
  const successes = results.filter((r) => r.success).length;
  return successes / results.length;
}

// --- Edit proposal -----------------------------------------------------------

/**
 * Ask an LLM (via runGoal react mode) to propose ONE edit to program.md based
 * on past failures. Returns the new program content, or null if parsing fails.
 */
export async function proposeEdit(
  currentProgram: string,
  failures: TaskResult[],
  tenantId?: string
): Promise<{ editDescription: string; newContent: string } | null> {
  const failureSummary = failures.length === 0
    ? "(no failures; propose an improvement to increase robustness or efficiency)"
    : failures.map((f, i) => `${i + 1}. ${f.taskGoal}`).join("\n");

  const prompt = [
    "You are improving an agent's operating manual (program.md).",
    "",
    "Current program.md:",
    "```",
    currentProgram,
    "```",
    "",
    "These evaluation tasks failed (or need improvement):",
    failureSummary,
    "",
    "Propose ONE specific edit to program.md that would help.",
    "Output ONLY a single JSON object on one line (no markdown fences, no prose) of the form:",
    `{"edit_description": "...", "new_content": "<full new program.md>"}`
  ].join("\n");

  try {
    const ctx = await runGoal(prompt, { tenantId, executionMode: "react" });
    const message = ctx.result?.message ?? "";
    return parseEditProposal(message);
  } catch (err) {
    logModuleError("self-improving", "optional", err, "proposeEdit");
    return null;
  }
}

/** Extract {edit_description, new_content} from LLM output. Tolerant of fences. */
export function parseEditProposal(
  raw: string
): { editDescription: string; newContent: string } | null {
  if (!raw) return null;
  // Strip markdown fences if present
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  // Find first balanced JSON object
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;

  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    const editDescription = typeof obj.edit_description === "string" ? obj.edit_description : "";
    const newContent = typeof obj.new_content === "string" ? obj.new_content : "";
    if (!newContent) return null;
    return { editDescription, newContent };
  } catch {
    return null;
  }
}

// --- Main loop ---------------------------------------------------------------

export async function runSelfImproving(
  options: SelfImprovingOptions
): Promise<SelfImprovingResult> {
  const programPath = options.programPath ?? DEFAULT_PROGRAM_PATH;
  const maxGen = Math.max(1, options.maxGenerations);
  const generations: Generation[] = [];

  // Generation 0: baseline
  let currentProgram = options.initialProgram;
  saveProgram(programPath, currentProgram);

  const base = await evaluateGeneration(currentProgram, options.evaluationTasks, options.tenantId);
  const gen0: Generation = {
    number: 0,
    programContent: currentProgram,
    taskResults: base.results,
    score: base.score,
    editAccepted: true,
    createdAt: new Date().toISOString()
  };
  generations.push(gen0);
  options.onGeneration?.(gen0);

  let bestScore = base.score;

  for (let i = 1; i < maxGen; i++) {
    const failures = generations[generations.length - 1].taskResults.filter((r) => !r.success);
    const proposal = await proposeEdit(currentProgram, failures, options.tenantId);

    if (!proposal) {
      const gen: Generation = {
        number: i,
        programContent: currentProgram,
        taskResults: [],
        score: bestScore,
        editAccepted: false,
        createdAt: new Date().toISOString()
      };
      generations.push(gen);
      options.onGeneration?.(gen);
      continue;
    }

    // Apply candidate edit
    const previousProgram = currentProgram;
    saveProgram(programPath, proposal.newContent);

    const evalResult = await evaluateGeneration(
      proposal.newContent,
      options.evaluationTasks,
      options.tenantId
    );

    const accepted = evalResult.score > bestScore;
    if (accepted) {
      currentProgram = proposal.newContent;
      bestScore = evalResult.score;
    } else {
      // Revert
      saveProgram(programPath, previousProgram);
    }

    const gen: Generation = {
      number: i,
      programContent: accepted ? proposal.newContent : previousProgram,
      taskResults: evalResult.results,
      score: evalResult.score,
      proposedEdit: proposal.editDescription,
      editAccepted: accepted,
      createdAt: new Date().toISOString()
    };
    generations.push(gen);
    options.onGeneration?.(gen);
  }

  return {
    initialScore: base.score,
    finalScore: bestScore,
    improvement: bestScore - base.score,
    generations,
    finalProgram: currentProgram
  };
}
