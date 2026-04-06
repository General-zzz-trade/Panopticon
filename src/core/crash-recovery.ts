/**
 * Crash Recovery — detect and mark stale runs on server startup.
 *
 * Scans the runs table for entries with status 'pending' or 'running'
 * that were never completed (likely due to a server crash). Marks them
 * as failed with termination_reason='crash_recovery' and logs a summary.
 */

import { getDb } from "../db/client";
import { restoreWorkingMemory, clearWorkingMemory } from "../cognition/working-memory-persistence";

interface StaleRun {
  id: string;
  tenant_id: string;
  goal: string;
  status: string;
  started_at: string | null;
}

export interface CrashRecoveryResult {
  recovered: number;
  runIds: string[];
  withWorkingMemory: string[];
}

/**
 * Scan for stale runs and mark them as failed.
 * Call this once at server startup before accepting new requests.
 */
export function recoverStaleRuns(): CrashRecoveryResult {
  const db = getDb();

  const staleRuns = db
    .prepare(
      `SELECT id, tenant_id, goal, status, started_at
       FROM runs
       WHERE status IN ('pending', 'running')
         AND (ended_at IS NULL OR ended_at = '')`
    )
    .all() as StaleRun[];

  if (staleRuns.length === 0) {
    console.log("[crash-recovery] No stale runs found — clean startup.");
    return { recovered: 0, runIds: [], withWorkingMemory: [] };
  }

  const now = new Date().toISOString();
  const runIds: string[] = [];
  const withWorkingMemory: string[] = [];

  const updateStmt = db.prepare(
    `UPDATE runs
     SET status = 'failed',
         result_success = 0,
         result_message = 'Run terminated by crash recovery on server restart',
         termination_reason = 'crash_recovery',
         ended_at = ?
     WHERE id = ?`
  );

  const markAll = db.transaction(() => {
    for (const run of staleRuns) {
      // Check if working memory was persisted for this run
      const wm = restoreWorkingMemory(run.id);
      const hadWorkingMemory = wm !== null;

      if (hadWorkingMemory) {
        withWorkingMemory.push(run.id);
        // Clean up saved working memory since the run is being terminated
        clearWorkingMemory(run.id);
      }

      updateStmt.run(now, run.id);
      runIds.push(run.id);

      console.log(
        `[crash-recovery] Marked run ${run.id} as failed ` +
        `(was '${run.status}', tenant=${run.tenant_id}, ` +
        `had_wm=${hadWorkingMemory}, goal="${truncate(run.goal, 80)}")`
      );
    }
  });

  markAll();

  console.log(
    `[crash-recovery] Recovered ${runIds.length} stale run(s): ` +
    `${withWorkingMemory.length} had persisted working memory.`
  );

  return { recovered: runIds.length, runIds, withWorkingMemory };
}

function truncate(str: string | null, max: number): string {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;
}
