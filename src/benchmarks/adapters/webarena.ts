/**
 * WebArena Benchmark Adapter — loads WebArena-format task JSON files
 * and translates them to the BenchmarkProtocol interface.
 *
 * WebArena task format:
 *   { task_id, require_login, sites, intent, start_url, eval: { eval_types, reference_answers } }
 *
 * Reference: https://github.com/web-arena-x/webarena
 */

import * as fs from "fs";
import { runGoal, type RunOptions } from "../../core/runtime";
import type { RunContext } from "../../types";
import type { BenchmarkProtocol, BenchmarkTaskSpec, BenchmarkResult } from "../protocol";
import { createReport } from "../protocol";

interface WebArenaReferenceAnswers {
  must_include?: string[];
  must_exclude?: string[];
  fuzzy_match?: string[];
  exact_match?: string;
}

interface WebArenaTask {
  task_id: number;
  require_login: boolean;
  sites: string[];
  intent: string;
  start_url: string;
  eval: {
    eval_types: string[];
    reference_answers: WebArenaReferenceAnswers;
  };
}

export function createWebArenaAdapter(taskFilePath: string): BenchmarkProtocol {
  let tasks: WebArenaTask[] = [];

  return {
    name: "webarena",

    async loadTasks(): Promise<BenchmarkTaskSpec[]> {
      const raw = fs.readFileSync(taskFilePath, "utf-8");
      tasks = JSON.parse(raw) as WebArenaTask[];

      return tasks.map(t => ({
        id: `wa-${t.task_id}`,
        name: t.intent.slice(0, 80),
        difficulty: t.sites.length > 1 ? "complex" : "medium",
        category: t.sites[0] ?? "web",
        goal: buildGoalFromWebArena(t),
        startUrl: t.start_url,
        metadata: {
          requireLogin: t.require_login,
          sites: t.sites,
          evalTypes: t.eval.eval_types,
          referenceAnswers: t.eval.reference_answers
        }
      }));
    },

    async runTask(task: BenchmarkTaskSpec, runOptions?: Partial<RunOptions>): Promise<RunContext> {
      return runGoal(task.goal, {
        ...runOptions,
        executionMode: "sequential"
      });
    },

    evaluateResult(task: BenchmarkTaskSpec, context: RunContext): BenchmarkResult {
      const meta = task.metadata as { referenceAnswers?: WebArenaReferenceAnswers; evalTypes?: string[] } | undefined;
      const answers = meta?.referenceAnswers;
      const evalTypes = meta?.evalTypes ?? ["string_match"];

      let passed = context.result?.success === true;

      // Apply WebArena evaluation rules
      if (answers && context.result?.message) {
        const output = context.result.message.toLowerCase();

        if (evalTypes.includes("string_match")) {
          if (answers.must_include?.length) {
            passed = answers.must_include.every(s => output.includes(s.toLowerCase()));
          }
          if (answers.must_exclude?.length) {
            passed = passed && answers.must_exclude.every(s => !output.includes(s.toLowerCase()));
          }
          if (answers.exact_match) {
            passed = output.includes(answers.exact_match.toLowerCase());
          }
        }

        if (evalTypes.includes("fuzzy_match") && answers.fuzzy_match?.length) {
          passed = answers.fuzzy_match.some(s =>
            output.includes(s.toLowerCase()) ||
            levenshteinSimilarity(output, s.toLowerCase()) > 0.8
          );
        }
      }

      return {
        taskId: task.id,
        passed,
        durationMs: context.metrics?.averageTaskDurationMs
          ? context.metrics.averageTaskDurationMs * (context.metrics.totalTasks || 1)
          : 0,
        context,
        error: context.result?.error
      };
    },

    generateReport(results: BenchmarkResult[]) {
      return createReport("webarena", results);
    }
  };
}

function buildGoalFromWebArena(task: WebArenaTask): string {
  return `open page "${task.start_url}" and ${task.intent}`;
}

function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) { matrix[i][j] = j; continue; }
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return 1 - matrix[a.length][b.length] / maxLen;
}
