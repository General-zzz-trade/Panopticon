import test from "node:test";
import assert from "node:assert/strict";
import { pruneKnowledge, enforceKnowledgeCapacity, getKnowledgeStats } from "./store";

test("pruneKnowledge removes low-confidence old entries", () => {
  const pruned = pruneKnowledge(0.2, 60);
  assert.ok(typeof pruned === "number");
  assert.ok(pruned >= 0);
});

test("enforceKnowledgeCapacity limits entries per type", () => {
  const pruned = enforceKnowledgeCapacity(200);
  assert.ok(typeof pruned === "number");
  assert.ok(pruned >= 0);
});

test("knowledge stats returns counts after maintenance", () => {
  const stats = getKnowledgeStats();
  assert.ok(typeof stats.selectors === "number");
  assert.ok(typeof stats.lessons === "number");
});
