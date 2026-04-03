import test from "node:test";
import assert from "node:assert/strict";
import { upsertLesson, getLessonsForTaskType, getKnowledgeStats } from "./store";

test("knowledge store handles 100 rapid inserts", () => {
  const start = Date.now();

  for (let i = 0; i < 100; i++) {
    upsertLesson({
      taskType: "click",
      errorPattern: `error-pattern-${i}`,
      recovery: `recovery-${i}`,
      successCount: 1,
      domain: "perf-test.com"
    });
  }

  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `100 inserts took ${elapsed}ms (limit: 2000ms)`);
});

test("knowledge store retrieval is fast with many entries", () => {
  const start = Date.now();
  const lessons = getLessonsForTaskType("click", "perf-test.com");
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 50, `Retrieval took ${elapsed}ms (limit: 50ms)`);
  assert.ok(lessons.length > 0);
});

test("getKnowledgeStats completes quickly", () => {
  const start = Date.now();
  const stats = getKnowledgeStats();
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 50, `Stats took ${elapsed}ms (limit: 50ms)`);
  assert.ok(typeof stats.selectors === "number");
});
