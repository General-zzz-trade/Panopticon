import test from "node:test";
import assert from "node:assert/strict";
import {
  planCoordination,
  getReadyWorkers,
  completeWorker,
  isCoordinationComplete,
  generateReport
} from "./coordinator";

test("planCoordination: single goal stays single", () => {
  const plan = planCoordination("open the dashboard");
  assert.equal(plan.strategy, "single");
  assert.equal(plan.workers.length, 1);
});

test("planCoordination: comma-separated list becomes parallel", () => {
  const plan = planCoordination("test login with empty password, invalid email, and correct credentials");
  assert.equal(plan.strategy, "parallel");
  assert.equal(plan.workers.length, 3);
  assert.ok(plan.workers[0].goal.includes("empty password"));
  assert.ok(plan.workers[1].goal.includes("invalid email"));
  assert.ok(plan.workers[2].goal.includes("correct credentials"));
});

test("planCoordination: parallel with syntax", () => {
  const plan = planCoordination("test login flow in parallel with signup flow");
  assert.equal(plan.strategy, "parallel");
  assert.equal(plan.workers.length, 2);
});

test("planCoordination: numbered list", () => {
  const plan = planCoordination("1. open page  2. click login  3. verify dashboard");
  assert.ok(plan.workers.length >= 3);
});

test("getReadyWorkers: all pending workers ready when no deps", () => {
  const plan = planCoordination("test A, B, and C");
  const ready = getReadyWorkers(plan);
  assert.equal(ready.length, 3);
});

test("getReadyWorkers: blocked workers not ready", () => {
  const plan = planCoordination("test A, B, and C");
  plan.dependencies.set("worker-1", ["worker-0"]);
  const ready = getReadyWorkers(plan);
  assert.equal(ready.length, 2);  // worker-0 and worker-2 ready, worker-1 blocked
  assert.ok(ready.some(w => w.id === "worker-0"));
  assert.ok(ready.some(w => w.id === "worker-2"));
});

test("completeWorker: marks worker done", () => {
  const plan = planCoordination("test A and B");
  completeWorker(plan, "worker-0", {
    success: true, summary: "done", artifacts: [], durationMs: 100
  });
  assert.equal(plan.workers[0].status, "done");
  assert.ok(plan.workers[0].completedAt);
});

test("completeWorker: marks worker failed", () => {
  const plan = planCoordination("test A and B");
  completeWorker(plan, "worker-0", {
    success: false, summary: "error", artifacts: [], durationMs: 50
  });
  assert.equal(plan.workers[0].status, "failed");
});

test("isCoordinationComplete: false when workers pending", () => {
  const plan = planCoordination("test A and B");
  assert.equal(isCoordinationComplete(plan), false);
});

test("isCoordinationComplete: true when all done", () => {
  const plan = planCoordination("test A and B");
  completeWorker(plan, "worker-0", { success: true, summary: "ok", artifacts: [], durationMs: 100 });
  completeWorker(plan, "worker-1", { success: true, summary: "ok", artifacts: [], durationMs: 100 });
  assert.equal(isCoordinationComplete(plan), true);
});

test("isCoordinationComplete: true when mix of done and failed", () => {
  const plan = planCoordination("test A and B");
  completeWorker(plan, "worker-0", { success: true, summary: "ok", artifacts: [], durationMs: 100 });
  completeWorker(plan, "worker-1", { success: false, summary: "err", artifacts: [], durationMs: 50 });
  assert.equal(isCoordinationComplete(plan), true);
});

test("generateReport: correct counts", () => {
  const plan = planCoordination("test A, B, and C");
  completeWorker(plan, "worker-0", { success: true, summary: "ok", artifacts: [], durationMs: 100 });
  completeWorker(plan, "worker-1", { success: false, summary: "err", artifacts: [], durationMs: 50 });
  completeWorker(plan, "worker-2", { success: true, summary: "ok", artifacts: [], durationMs: 200 });

  const report = generateReport(plan);
  assert.equal(report.totalWorkers, 3);
  assert.equal(report.succeeded, 2);
  assert.equal(report.failed, 1);
  assert.equal(report.totalDurationMs, 350);
  assert.ok(report.summary.includes("2/3 succeeded"));
});

test("getReadyWorkers: unblocks after dependency completes", () => {
  const plan = planCoordination("test A, B, and C");
  plan.dependencies.set("worker-1", ["worker-0"]);

  // Initially worker-1 is blocked
  let ready = getReadyWorkers(plan);
  assert.ok(!ready.some(w => w.id === "worker-1"));

  // Complete worker-0
  completeWorker(plan, "worker-0", { success: true, summary: "ok", artifacts: [], durationMs: 100 });

  // Now worker-1 should be ready
  ready = getReadyWorkers(plan);
  assert.ok(ready.some(w => w.id === "worker-1"));
});
