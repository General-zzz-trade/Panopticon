import test from "node:test";
import assert from "node:assert/strict";
import { topologicalSort, getParallelGroups, type SubGoal } from "./llm-decomposer";

test("topologicalSort orders by dependency", () => {
  const goals: SubGoal[] = [
    { id: "sg-2", goal: "navigate to dashboard", dependsOn: ["sg-0"] },
    { id: "sg-0", goal: "login", dependsOn: [] },
    { id: "sg-1", goal: "check homepage", dependsOn: [] },
  ];
  const sorted = topologicalSort(goals);
  const ids = sorted.map(sg => sg.id);

  // sg-0 must come before sg-2
  assert.ok(ids.indexOf("sg-0") < ids.indexOf("sg-2"));
  // sg-1 has no deps, can be anywhere
  assert.equal(sorted.length, 3);
});

test("topologicalSort detects cycles", () => {
  const goals: SubGoal[] = [
    { id: "sg-0", goal: "A", dependsOn: ["sg-1"] },
    { id: "sg-1", goal: "B", dependsOn: ["sg-0"] },
  ];
  assert.throws(() => topologicalSort(goals), /Cycle detected/);
});

test("topologicalSort handles single goal", () => {
  const goals: SubGoal[] = [
    { id: "sg-0", goal: "do something", dependsOn: [] },
  ];
  const sorted = topologicalSort(goals);
  assert.equal(sorted.length, 1);
  assert.equal(sorted[0].id, "sg-0");
});

test("getParallelGroups groups independent goals together", () => {
  const goals: SubGoal[] = [
    { id: "sg-0", goal: "login", dependsOn: [] },
    { id: "sg-1", goal: "check A", dependsOn: ["sg-0"] },
    { id: "sg-2", goal: "check B", dependsOn: ["sg-0"] },
    { id: "sg-3", goal: "final report", dependsOn: ["sg-1", "sg-2"] },
  ];
  const groups = getParallelGroups(goals);

  assert.equal(groups.length, 3);
  // Group 0: just login
  assert.deepEqual(groups[0].map(g => g.id), ["sg-0"]);
  // Group 1: check A and check B in parallel
  assert.deepEqual(groups[1].map(g => g.id).sort(), ["sg-1", "sg-2"]);
  // Group 2: final report
  assert.deepEqual(groups[2].map(g => g.id), ["sg-3"]);
});

test("getParallelGroups detects cycles", () => {
  const goals: SubGoal[] = [
    { id: "sg-0", goal: "A", dependsOn: ["sg-1"] },
    { id: "sg-1", goal: "B", dependsOn: ["sg-0"] },
  ];
  assert.throws(() => getParallelGroups(goals), /Cycle detected/);
});
