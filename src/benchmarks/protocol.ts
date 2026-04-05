/**
 * Benchmark Protocol — generic interface for benchmark adapters.
 * Allows the A/B runner to work with any benchmark format (internal, WebArena, Mind2Web, etc.)
 */

import type { RunContext } from "../types";
import type { RunOptions } from "../core/runtime";

export interface BenchmarkTaskSpec {
  id: string;
  name: string;
  difficulty: string;
  category: string;
  goal: string;
  /** Optional start URL for the task */
  startUrl?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface BenchmarkResult {
  taskId: string;
  passed: boolean;
  durationMs: number;
  context?: RunContext;
  error?: string;
}

export interface BenchmarkProtocol {
  /** Human-readable name of this benchmark suite */
  name: string;
  /** Load all available tasks */
  loadTasks(): Promise<BenchmarkTaskSpec[]>;
  /** Run a single benchmark task and return the raw context */
  runTask(task: BenchmarkTaskSpec, runOptions?: Partial<RunOptions>): Promise<RunContext>;
  /** Evaluate the result of a task against expected outcome */
  evaluateResult(task: BenchmarkTaskSpec, context: RunContext): BenchmarkResult;
  /** Generate a summary report from all results */
  generateReport(results: BenchmarkResult[]): BenchmarkReport;
}

export interface BenchmarkReport {
  suiteName: string;
  totalTasks: number;
  passed: number;
  failed: number;
  successRate: number;
  totalDurationMs: number;
  avgDurationMs: number;
  results: BenchmarkResult[];
}

export function createReport(suiteName: string, results: BenchmarkResult[]): BenchmarkReport {
  const passed = results.filter(r => r.passed).length;
  const totalDuration = results.reduce((s, r) => s + r.durationMs, 0);
  return {
    suiteName,
    totalTasks: results.length,
    passed,
    failed: results.length - passed,
    successRate: results.length > 0 ? passed / results.length : 0,
    totalDurationMs: totalDuration,
    avgDurationMs: results.length > 0 ? totalDuration / results.length : 0,
    results
  };
}
