/**
 * Autonomous Loop — the agent's continuous self-driven runtime.
 *
 * Connects environment watchers → goal synthesizer → runGoal, forming
 * a loop that runs without human input:
 *   1. Watchers detect environment changes
 *   2. Triggers get synthesized into goals
 *   3. Agent executes goals autonomously
 *   4. Results feed back into memory for future triggers
 */

import { onTrigger, registerWatcher, stopAllWatchers, type WatcherConfig, type Trigger } from "./environment-watcher";
import { synthesizeGoal, registerDefaultRules } from "./goal-synthesizer";
import { runGoal } from "../core/runtime";
import { logModuleError } from "../core/module-logger";

export interface AutonomousLoopOptions {
  /** Max concurrent goal executions */
  maxConcurrent?: number;
  /** Cooldown between same-trigger-type executions (ms) */
  cooldownMs?: number;
  /** Called after each autonomous run */
  onRunComplete?: (trigger: Trigger, success: boolean, message: string) => void;
}

interface ExecutionRecord {
  trigger: Trigger;
  goal: string;
  startedAt: number;
}

const activeExecutions = new Set<ExecutionRecord>();
const lastExecutedByType = new Map<string, number>();
let loopActive = false;
let loopOptions: AutonomousLoopOptions = {};

/**
 * Start the autonomous loop.
 */
export function startAutonomousLoop(options: AutonomousLoopOptions = {}): void {
  if (loopActive) return;
  loopActive = true;
  loopOptions = options;

  registerDefaultRules();

  onTrigger(async (trigger) => {
    if (!loopActive) return;

    // Cooldown check
    const lastExec = lastExecutedByType.get(trigger.type) ?? 0;
    const cooldown = options.cooldownMs ?? 10000;
    if (Date.now() - lastExec < cooldown) {
      return;
    }

    // Concurrency check
    const maxConc = options.maxConcurrent ?? 3;
    if (activeExecutions.size >= maxConc) {
      return;
    }

    // Synthesize goal
    const synthesized = synthesizeGoal(trigger);
    if (!synthesized) {
      return;
    }

    // Execute
    const record: ExecutionRecord = {
      trigger,
      goal: synthesized.goal,
      startedAt: Date.now()
    };
    activeExecutions.add(record);
    lastExecutedByType.set(trigger.type, Date.now());

    console.log(`[autonomous] Trigger: ${trigger.type} → Goal: ${synthesized.goal.slice(0, 80)}`);

    try {
      const ctx = await runGoal(synthesized.goal, {
        executionMode: (synthesized.mode ?? "sequential") as "sequential" | "react" | "cli"
      });
      const success = ctx.result?.success ?? false;
      const message = ctx.result?.message?.slice(0, 120) ?? "";
      console.log(`[autonomous] ${success ? "✓" : "✗"} ${message}`);
      if (options.onRunComplete) {
        try { options.onRunComplete(trigger, success, message); } catch (err) {
          logModuleError("autonomous-loop", "optional", err, "onRunComplete callback");
        }
      }
    } catch (err) {
      logModuleError("autonomous-loop", "optional", err, `executing goal for ${trigger.type}`);
    } finally {
      activeExecutions.delete(record);
    }
  });
}

/**
 * Stop the autonomous loop and all watchers.
 */
export function stopAutonomousLoop(): void {
  loopActive = false;
  stopAllWatchers();
}

/**
 * Get current loop status.
 */
export function getLoopStatus(): {
  active: boolean;
  activeExecutions: number;
  activeGoals: string[];
} {
  return {
    active: loopActive,
    activeExecutions: activeExecutions.size,
    activeGoals: Array.from(activeExecutions).map(e => e.goal)
  };
}

/**
 * Add a watcher to the autonomous system.
 */
export function addAutonomousWatcher(config: WatcherConfig): void {
  registerWatcher(config);
}
