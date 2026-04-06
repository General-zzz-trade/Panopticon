/**
 * Batch Investigation — process multiple targets from CSV/list
 */

export interface BatchTarget {
  target: string;
  type?: string;
  label?: string;
}

export interface BatchResult {
  targets: BatchTarget[];
  results: BatchItemResult[];
  stats: {
    total: number;
    succeeded: number;
    failed: number;
    totalDurationMs: number;
  };
  timestamp: string;
}

export interface BatchItemResult {
  target: string;
  label?: string;
  status: "success" | "failed";
  data?: any;
  error?: string;
  durationMs: number;
}

// ── Parse CSV/Text Input ────────────────────────────────

export function parseBatchInput(input: string): BatchTarget[] {
  const targets: BatchTarget[] = [];
  const lines = input.trim().split("\n").filter(l => l.trim() && !l.startsWith("#"));

  for (const line of lines) {
    const parts = line.split(",").map(s => s.trim());
    if (parts.length === 0 || !parts[0]) continue;

    targets.push({
      target: parts[0],
      type: parts[1] || undefined,
      label: parts[2] || undefined,
    });
  }

  return targets;
}

// ── Batch Executor ──────────────────────────────────────

export async function executeBatch(
  targets: BatchTarget[],
  investigationType?: string,
  concurrency = 3,
  onProgress?: (completed: number, total: number, current: string) => void
): Promise<BatchResult> {
  const start = Date.now();
  const results: BatchItemResult[] = [];

  // Process in batches for concurrency control
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (t) => {
        const itemStart = Date.now();
        onProgress?.(results.length, targets.length, t.target);

        try {
          const { investigate } = await import("./index.js");
          const type = (t.type || investigationType || undefined) as any;
          const data = await investigate(t.target, type);

          return {
            target: t.target,
            label: t.label,
            status: "success" as const,
            data: {
              riskLevel: data.report.riskLevel,
              entityCount: (data.graph as any).stats?.entityCount,
              relationCount: (data.graph as any).stats?.relationCount,
              riskFactors: data.report.riskFactors,
            },
            durationMs: Date.now() - itemStart,
          };
        } catch (err) {
          return {
            target: t.target,
            label: t.label,
            status: "failed" as const,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - itemStart,
          };
        }
      })
    );

    results.push(...batchResults);
  }

  const succeeded = results.filter(r => r.status === "success").length;

  return {
    targets,
    results,
    stats: {
      total: targets.length,
      succeeded,
      failed: targets.length - succeeded,
      totalDurationMs: Date.now() - start,
    },
    timestamp: new Date().toISOString(),
  };
}
