import test from "node:test";
import assert from "node:assert/strict";
import {
  planCoordination,
  getReadyWorkers,
  completeWorker,
  isCoordinationComplete,
  generateReport
} from "./coordinator";

test("planCoordination decomposes parallel goal into workers", () => {
  const plan = planCoordination("test login, registration, and profile");
  assert.equal(plan.strategy, "parallel");
  assert.equal(plan.workers.length, 3);
  assert.ok(plan.workers[0].goal.includes("login"));
  assert.ok(plan.workers[1].goal.includes("registration"));
  assert.ok(plan.workers[2].goal.includes("profile"));
});

test("planCoordination returns single for non-decomposable goal", () => {
  const plan = planCoordination("open the dashboard and take a screenshot");
  assert.equal(plan.strategy, "single");
  assert.equal(plan.workers.length, 1);
});

test("getReadyWorkers returns all workers when no dependencies", () => {
  const plan = planCoordination("check login, signup, and dashboard");
  const ready = getReadyWorkers(plan);
  assert.equal(ready.length, plan.workers.length);
});

test("completeWorker updates status and result", () => {
  const plan = planCoordination("verify A, B, and C");
  completeWorker(plan, "worker-0", {
    success: true,
    summary: "Done",
    artifacts: [],
    durationMs: 100
  });

  const w0 = plan.workers.find(w => w.id === "worker-0");
  assert.equal(w0!.status, "done");
  assert.equal(w0!.result!.durationMs, 100);
});

test("isCoordinationComplete returns true when all done", () => {
  const plan = planCoordination("test X, Y, and Z");
  assert.equal(isCoordinationComplete(plan), false);

  for (const worker of plan.workers) {
    completeWorker(plan, worker.id, {
      success: true, summary: "ok", artifacts: [], durationMs: 50
    });
  }

  assert.equal(isCoordinationComplete(plan), true);
});

test("generateReport summarizes coordination results", () => {
  const plan = planCoordination("validate A, B, and C");
  completeWorker(plan, "worker-0", { success: true, summary: "ok", artifacts: [], durationMs: 100 });
  completeWorker(plan, "worker-1", { success: false, summary: "fail", artifacts: [], durationMs: 200 });
  completeWorker(plan, "worker-2", { success: true, summary: "ok", artifacts: [], durationMs: 150 });

  const report = generateReport(plan);
  assert.equal(report.succeeded, 2);
  assert.equal(report.failed, 1);
  assert.equal(report.totalWorkers, 3);
  assert.ok(report.summary.includes("2/3 succeeded"));
});

test("dependency-aware coordination: sequential workers", () => {
  // "after" keyword triggers dependency detection
  const plan = planCoordination("1. setup database 2. after that run tests 3. clean up");
  // The numbered pattern should decompose
  assert.ok(plan.workers.length >= 2);
});
