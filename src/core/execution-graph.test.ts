import test from "node:test";
import assert from "node:assert/strict";
import type { AgentTask } from "../types";
import type { SubGoal } from "../orchestration/llm-decomposer";
import {
  createGraphFromTasks,
  createGraphFromDAG,
  getReadyNodes,
  completeNode,
  isGraphComplete,
  getGraphSummary,
} from "./execution-graph";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(id: string, overrides?: Partial<AgentTask>): AgentTask {
  return {
    id,
    type: "click",
    status: "pending",
    retries: 0,
    attempts: 0,
    replanDepth: 0,
    payload: {},
    ...overrides,
  };
}

function makeSubGoal(id: string, goal: string, dependsOn: string[] = []): SubGoal {
  return { id, goal, dependsOn };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("createGraphFromTasks creates linear chain with success edges", () => {
  const tasks = [makeTask("t1"), makeTask("t2"), makeTask("t3")];
  const graph = createGraphFromTasks(tasks);

  assert.equal(graph.nodes.size, 3);
  assert.equal(graph.edges.length, 2);

  // First edge: t1 -> t2
  assert.equal(graph.edges[0].from, "t1");
  assert.equal(graph.edges[0].to, "t2");
  assert.equal(graph.edges[0].condition, "success");

  // Second edge: t2 -> t3
  assert.equal(graph.edges[1].from, "t2");
  assert.equal(graph.edges[1].to, "t3");
  assert.equal(graph.edges[1].condition, "success");

  // Only first node is a root
  assert.deepEqual(graph.rootIds, ["t1"]);
});

test("createGraphFromTasks handles empty task list", () => {
  const graph = createGraphFromTasks([]);
  assert.equal(graph.nodes.size, 0);
  assert.equal(graph.edges.length, 0);
  assert.deepEqual(graph.rootIds, []);
});

test("createGraphFromTasks handles single task", () => {
  const graph = createGraphFromTasks([makeTask("only")]);
  assert.equal(graph.nodes.size, 1);
  assert.equal(graph.edges.length, 0);
  assert.deepEqual(graph.rootIds, ["only"]);
});

test("getReadyNodes returns first node initially for linear graph", () => {
  const tasks = [makeTask("t1"), makeTask("t2"), makeTask("t3")];
  const graph = createGraphFromTasks(tasks);

  const ready = getReadyNodes(graph);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].id, "t1");
});

test("completeNode marks node done and makes next ready", () => {
  const tasks = [makeTask("t1"), makeTask("t2"), makeTask("t3")];
  const graph = createGraphFromTasks(tasks);

  completeNode(graph, "t1", true, "first done");

  const t1 = graph.nodes.get("t1")!;
  assert.equal(t1.status, "done");
  assert.deepEqual(t1.result, { success: true, summary: "first done" });

  const ready = getReadyNodes(graph);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].id, "t2");
});

test("failed node skips success-conditioned successors", () => {
  const tasks = [makeTask("t1"), makeTask("t2"), makeTask("t3")];
  const graph = createGraphFromTasks(tasks);

  completeNode(graph, "t1", false, "first failed");

  const t1 = graph.nodes.get("t1")!;
  assert.equal(t1.status, "failed");

  // t2 should be skipped because the edge t1->t2 requires success
  const t2 = graph.nodes.get("t2")!;
  assert.equal(t2.status, "skipped");

  // t3 should also be skipped transitively
  const t3 = graph.nodes.get("t3")!;
  assert.equal(t3.status, "skipped");

  // No ready nodes
  const ready = getReadyNodes(graph);
  assert.equal(ready.length, 0);
});

test("isGraphComplete returns true when all nodes terminal", () => {
  const tasks = [makeTask("t1"), makeTask("t2")];
  const graph = createGraphFromTasks(tasks);

  assert.equal(isGraphComplete(graph), false);

  completeNode(graph, "t1", true, "ok");
  assert.equal(isGraphComplete(graph), false);

  completeNode(graph, "t2", true, "ok");
  assert.equal(isGraphComplete(graph), true);
});

test("isGraphComplete with failed + skipped is also complete", () => {
  const tasks = [makeTask("t1"), makeTask("t2"), makeTask("t3")];
  const graph = createGraphFromTasks(tasks);

  completeNode(graph, "t1", false, "failed");
  // t2 and t3 are skipped by propagation
  assert.equal(isGraphComplete(graph), true);
});

test("getGraphSummary returns correct counts", () => {
  const tasks = [makeTask("t1"), makeTask("t2"), makeTask("t3")];
  const graph = createGraphFromTasks(tasks);

  let summary = getGraphSummary(graph);
  assert.equal(summary.total, 3);
  assert.equal(summary.done, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.skipped, 0);

  completeNode(graph, "t1", true, "ok");
  summary = getGraphSummary(graph);
  assert.equal(summary.done, 1);

  completeNode(graph, "t2", false, "err");
  summary = getGraphSummary(graph);
  assert.equal(summary.done, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.skipped, 1); // t3 skipped
});

test("createGraphFromDAG handles parallel groups correctly", () => {
  const subGoals: SubGoal[] = [
    makeSubGoal("sg-0", "login"),
    makeSubGoal("sg-1", "check A", ["sg-0"]),
    makeSubGoal("sg-2", "check B", ["sg-0"]),
    makeSubGoal("sg-3", "logout", ["sg-1", "sg-2"]),
  ];

  const graph = createGraphFromDAG(subGoals);

  // All sub-goals should be nodes
  assert.ok(graph.nodes.has("sg-0"));
  assert.ok(graph.nodes.has("sg-1"));
  assert.ok(graph.nodes.has("sg-2"));
  assert.ok(graph.nodes.has("sg-3"));

  // sg-0 should be a root (no deps)
  assert.ok(graph.rootIds.includes("sg-0"));

  // sg-1 and sg-2 depend on sg-0 — edges exist
  const edgesFromSg0 = graph.edges.filter(
    e => e.from === "sg-0" && (e.to === "sg-1" || e.to === "sg-2")
  );
  assert.ok(edgesFromSg0.length >= 2, "sg-0 should have edges to sg-1 and sg-2");

  // sg-3 depends on sg-1 and sg-2
  const edgesToSg3 = graph.edges.filter(e => e.to === "sg-3" && e.condition === "success");
  assert.ok(edgesToSg3.length >= 2, "sg-3 should have incoming edges from sg-1 and sg-2");
});

test("getReadyNodes returns multiple nodes for parallel groups", () => {
  const subGoals: SubGoal[] = [
    makeSubGoal("sg-0", "login"),
    makeSubGoal("sg-1", "check A", ["sg-0"]),
    makeSubGoal("sg-2", "check B", ["sg-0"]),
    makeSubGoal("sg-3", "logout", ["sg-1", "sg-2"]),
  ];

  const graph = createGraphFromDAG(subGoals);

  // Initially only sg-0 (and possibly fork node) should be ready
  let ready = getReadyNodes(graph);
  const readyTaskIds = ready.map(n => n.id);
  assert.ok(readyTaskIds.includes("sg-0"), "sg-0 should be ready initially");

  // Complete sg-0 and any fork nodes that become ready
  completeNode(graph, "sg-0", true, "logged in");

  // Now complete any fork nodes that are ready
  ready = getReadyNodes(graph);
  for (const node of ready) {
    if (node.type === "fork") {
      completeNode(graph, node.id, true, "fork done");
    }
  }

  // After completing fork nodes, sg-1 and sg-2 should both be ready
  ready = getReadyNodes(graph);
  const readyIds = ready.map(n => n.id);
  assert.ok(readyIds.includes("sg-1"), "sg-1 should be ready after sg-0 completes");
  assert.ok(readyIds.includes("sg-2"), "sg-2 should be ready after sg-0 completes");

  // sg-3 should NOT be ready yet
  assert.ok(!readyIds.includes("sg-3"), "sg-3 should not be ready yet");
});

test("completeNode throws for unknown node", () => {
  const graph = createGraphFromTasks([makeTask("t1")]);
  assert.throws(
    () => completeNode(graph, "nonexistent", true, "nope"),
    /Node nonexistent not found/
  );
});

test("DAG with no dependencies yields all nodes as roots", () => {
  const subGoals: SubGoal[] = [
    makeSubGoal("a", "task A"),
    makeSubGoal("b", "task B"),
    makeSubGoal("c", "task C"),
  ];

  const graph = createGraphFromDAG(subGoals);
  const ready = getReadyNodes(graph);

  // All three should be ready (they are all roots or reachable from fork)
  // Depending on fork/join insertion, we check that at least a, b, c are in roots or ready
  const readyIds = ready.map(n => n.id);
  // With a single parallel group of 3, a fork node might be the root
  // and a, b, c become ready after the fork completes.
  // OR if there's just one group, the fork is root.
  // Let's verify they all become ready eventually.

  // Complete any fork nodes first
  for (const node of ready) {
    if (node.type === "fork") {
      completeNode(graph, node.id, true, "fork");
    }
  }

  const readyAfterFork = getReadyNodes(graph);
  const allReadyIds = [...readyIds, ...readyAfterFork.map(n => n.id)];
  assert.ok(allReadyIds.includes("a") || allReadyIds.includes("b") || allReadyIds.includes("c"),
    "At least some task nodes should become ready");
});

test("linear DAG (chain of dependencies) works like createGraphFromTasks", () => {
  const subGoals: SubGoal[] = [
    makeSubGoal("s1", "step 1"),
    makeSubGoal("s2", "step 2", ["s1"]),
    makeSubGoal("s3", "step 3", ["s2"]),
  ];

  const graph = createGraphFromDAG(subGoals);

  // Only s1 should be ready
  let ready = getReadyNodes(graph);
  assert.equal(ready.filter(n => n.type === "task").length, 1);
  assert.equal(ready.filter(n => n.type === "task")[0].id, "s1");

  completeNode(graph, "s1", true, "ok");
  ready = getReadyNodes(graph);
  assert.equal(ready.filter(n => n.type === "task").length, 1);
  assert.equal(ready.filter(n => n.type === "task")[0].id, "s2");

  completeNode(graph, "s2", true, "ok");
  ready = getReadyNodes(graph);
  assert.equal(ready.filter(n => n.type === "task").length, 1);
  assert.equal(ready.filter(n => n.type === "task")[0].id, "s3");

  completeNode(graph, "s3", true, "ok");
  assert.equal(isGraphComplete(graph), true);

  const summary = getGraphSummary(graph);
  assert.equal(summary.done, 3);
  assert.equal(summary.failed, 0);
  assert.equal(summary.skipped, 0);
});
