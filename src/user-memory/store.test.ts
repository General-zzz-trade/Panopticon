import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "../db/client";
import { initUserMemoryTable, upsertMemory, getMemory, listMemory, deleteMemory, clearMemory, recordFrequentGoal, getFrequentGoals } from "./store";

beforeEach(() => {
  initUserMemoryTable();
  getDb().prepare("DELETE FROM user_memory").run();
});

test("upsertMemory + getMemory roundtrip", () => {
  upsertMemory("t1", "theme", "dark", "preference");
  const e = getMemory("t1", "theme");
  assert.equal(e?.value, "dark");
  assert.equal(e?.category, "preference");
});

test("upsertMemory: increments use_count on update", () => {
  upsertMemory("t1", "lang", "en");
  upsertMemory("t1", "lang", "zh");
  const e = getMemory("t1", "lang");
  assert.equal(e?.value, "zh");
  assert.ok((e?.useCount ?? 0) >= 2);
});

test("listMemory: returns all entries for tenant", () => {
  upsertMemory("t2", "k1", "v1");
  upsertMemory("t2", "k2", "v2");
  assert.equal(listMemory("t2").length, 2);
});

test("listMemory: category filter", () => {
  upsertMemory("t3", "pref1", "v1", "preference");
  upsertMemory("t3", "ctx1", "v2", "context");
  assert.equal(listMemory("t3", "preference").length, 1);
});

test("deleteMemory: removes entry", () => {
  upsertMemory("t4", "key", "val");
  deleteMemory("t4", "key");
  assert.equal(getMemory("t4", "key"), undefined);
});

test("clearMemory: removes all for tenant", () => {
  upsertMemory("t5", "a", "1");
  upsertMemory("t5", "b", "2");
  clearMemory("t5");
  assert.equal(listMemory("t5").length, 0);
});

test("recordFrequentGoal + getFrequentGoals", () => {
  recordFrequentGoal("t6", "open http://example.com and click login");
  recordFrequentGoal("t6", "open http://example.com and click login");
  recordFrequentGoal("t6", "screenshot http://example.com");
  const goals = getFrequentGoals("t6", 5);
  assert.ok(goals.length >= 2);
  assert.equal(goals[0], "open http://example.com and click login");
});
