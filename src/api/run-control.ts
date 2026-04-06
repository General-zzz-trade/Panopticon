/**
 * Run Control Registry
 *
 * Tracks cancellation requests per runId. The runtime checks `isCancelled(runId)`
 * at safe points (between tasks) and aborts gracefully.
 */
const cancelled = new Set<string>();

export function requestCancel(runId: string): void {
  cancelled.add(runId);
}

export function isCancelled(runId: string): boolean {
  return cancelled.has(runId);
}

export function clearCancel(runId: string): void {
  cancelled.delete(runId);
}
