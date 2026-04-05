/**
 * Checkpoint Manager — saves and restores execution state.
 * Enables long-horizon runs to resume from the last successful task
 * instead of restarting from scratch.
 */

import * as fs from "fs";
import * as path from "path";
import type { RunContext } from "../types";
import { logModuleError } from "./module-logger";

export interface Checkpoint {
  runId: string;
  goal: string;
  taskIndex: number;
  completedTaskIds: string[];
  summaries: string[];
  worldStateSnapshot: any;
  savedAt: string;
}

const CHECKPOINT_DIR = path.join(process.cwd(), "artifacts", "checkpoints");

/**
 * Save a checkpoint after a successful task.
 */
export function saveCheckpoint(
  context: RunContext,
  taskIndex: number,
  summaries: string[]
): void {
  try {
    if (!fs.existsSync(CHECKPOINT_DIR)) {
      fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
    }

    const checkpoint: Checkpoint = {
      runId: context.runId,
      goal: context.goal,
      taskIndex,
      completedTaskIds: context.tasks
        .filter(t => t.status === "done")
        .map(t => t.id),
      summaries: [...summaries],
      worldStateSnapshot: context.worldState ? {
        pageUrl: context.worldState.pageUrl,
        appState: context.worldState.appState,
        facts: context.worldState.facts
      } : null,
      savedAt: new Date().toISOString()
    };

    const filePath = path.join(CHECKPOINT_DIR, `${context.runId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2));
  } catch (error) {
    logModuleError("checkpoint", "critical", error, "saving checkpoint to disk");
  }
}

/**
 * Load the most recent checkpoint for a goal.
 * Returns null if no checkpoint exists.
 */
export function loadCheckpoint(goal: string): Checkpoint | null {
  try {
    if (!fs.existsSync(CHECKPOINT_DIR)) return null;

    const files = fs.readdirSync(CHECKPOINT_DIR)
      .filter(f => f.endsWith(".json"))
      .sort()
      .reverse();

    for (const file of files) {
      const filePath = path.join(CHECKPOINT_DIR, file);
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Checkpoint;
      if (data.goal === goal && data.completedTaskIds.length > 0) {
        return data;
      }
    }
  } catch (error) {
    logModuleError("checkpoint", "critical", error, "loading checkpoint from disk");
  }

  return null;
}

/**
 * Remove a checkpoint after successful run completion.
 */
export function clearCheckpoint(runId: string): void {
  try {
    const filePath = path.join(CHECKPOINT_DIR, `${runId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    logModuleError("checkpoint", "optional", error, "clearing checkpoint file");
  }
}

/**
 * Determine the starting task index based on a checkpoint.
 * Marks completed tasks as "done" in the context.
 */
export function applyCheckpoint(
  context: RunContext,
  checkpoint: Checkpoint
): { startIndex: number; restoredSummaries: string[] } {
  // Mark previously completed tasks as done
  for (const taskId of checkpoint.completedTaskIds) {
    const task = context.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = "done";
      task.attempts = 1;
    }
  }

  return {
    startIndex: checkpoint.taskIndex + 1,
    restoredSummaries: checkpoint.summaries
  };
}
