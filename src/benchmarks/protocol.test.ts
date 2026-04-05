import test from "node:test";
import assert from "node:assert/strict";
import { createReport, type BenchmarkResult } from "./protocol";

test("createReport computes correct statistics", () => {
  const results: BenchmarkResult[] = [
    { taskId: "t1", passed: true, durationMs: 100 },
    { taskId: "t2", passed: false, durationMs: 200, error: "timeout" },
    { taskId: "t3", passed: true, durationMs: 150 },
  ];
  const report = createReport("test-suite", results);
  assert.equal(report.suiteName, "test-suite");
  assert.equal(report.totalTasks, 3);
  assert.equal(report.passed, 2);
  assert.equal(report.failed, 1);
  assert.ok(Math.abs(report.successRate - 2/3) < 0.001);
  assert.equal(report.totalDurationMs, 450);
  assert.equal(report.avgDurationMs, 150);
});

test("createReport handles empty results", () => {
  const report = createReport("empty", []);
  assert.equal(report.totalTasks, 0);
  assert.equal(report.successRate, 0);
  assert.equal(report.avgDurationMs, 0);
});
