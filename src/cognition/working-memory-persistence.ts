/**
 * Working Memory Persistence — save/restore across runs and crashes.
 *
 * Unlike strategic learning (which persists knowledge), this persists
 * the active reasoning state so a crashed run can resume exactly where
 * it left off: attention focus, reasoning stack, facts, failure patterns.
 */

import { saveLearningState, loadLearningState } from "../learning/persistence";
import type { WorkingMemory, FailureSignature } from "./working-memory";
import { logModuleError } from "../core/module-logger";

interface SerializedWorkingMemory {
  focus: WorkingMemory["focus"];
  reasoningStack: WorkingMemory["reasoningStack"];
  facts: WorkingMemory["facts"];
  failurePatterns: Array<[string, FailureSignature]>;
  stepCount: number;
}

/**
 * Save working memory state to SQLite, keyed by runId.
 */
export function saveWorkingMemory(runId: string, wm: WorkingMemory): void {
  try {
    const serialized: SerializedWorkingMemory = {
      focus: wm.focus,
      reasoningStack: wm.reasoningStack,
      facts: wm.facts,
      failurePatterns: Array.from(wm.failurePatterns.entries()),
      stepCount: wm.stepCount
    };
    saveLearningState(`wm:${runId}`, serialized);
  } catch (err) {
    logModuleError("working-memory-persistence", "critical", err, `saving wm for ${runId}`);
  }
}

/**
 * Restore working memory state from SQLite by runId.
 * Returns null if no saved state exists.
 */
export function restoreWorkingMemory(runId: string): WorkingMemory | null {
  try {
    const data = loadLearningState<SerializedWorkingMemory>(`wm:${runId}`);
    if (!data) return null;
    return {
      focus: data.focus,
      reasoningStack: data.reasoningStack,
      facts: data.facts,
      failurePatterns: new Map(data.failurePatterns),
      stepCount: data.stepCount
    };
  } catch (err) {
    logModuleError("working-memory-persistence", "optional", err, `restoring wm for ${runId}`);
    return null;
  }
}

/**
 * Clear saved working memory for a completed run.
 */
export function clearWorkingMemory(runId: string): void {
  try {
    saveLearningState(`wm:${runId}`, null);
  } catch (err) {
    logModuleError("working-memory-persistence", "optional", err, `clearing wm for ${runId}`);
  }
}
