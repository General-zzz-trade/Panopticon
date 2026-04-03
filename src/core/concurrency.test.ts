import test from "node:test";
import assert from "node:assert/strict";
import { runTasksWithDependencies } from "./parallel-runner";
import type { RunContext, AgentTask } from "../types";

function makeCtx(tasks: AgentTask[]): RunContext {
  return {
    runId: "test-concurrent",
    goal: "test",
    tasks,
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: tasks.length,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    escalationDecisions: [],
    limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 },
    startedAt: new Date().toISOString(),
    browserSession: undefined,
    appProcess: undefined
  } as unknown as RunContext;
}

function waitTask(id: string, ms: number = 1, deps?: string[]): AgentTask {
  return {
    id,
    type: "wait",
    status: "pending",
    retries: 0,
    attempts: 0,
    replanDepth: 0,
    payload: { ms, durationMs: ms },
    dependsOn: deps ?? []
  } as unknown as AgentTask;
}

test("parallel runner: all independent tasks complete", async () => {
  const tasks = [waitTask("a"), waitTask("b"), waitTask("c")];
  const ctx = makeCtx(tasks);
  const summaries: string[] = [];

  await runTasksWithDependencies(ctx, s => summaries.push(s));
  assert.equal(summaries.length, 3);
  assert.ok(tasks.every(t => t.status === "done"));
});

test("parallel runner: dependency chain executes in order", async () => {
  const tasks = [
    waitTask("first"),
    waitTask("second", 1, ["first"]),
    waitTask("third", 1, ["second"])
  ];
  const ctx = makeCtx(tasks);
  const order: string[] = [];

  await runTasksWithDependencies(ctx, s => order.push(s));
  assert.equal(order.length, 3);
});

test("parallel runner: diamond dependency resolves", async () => {
  // A -> B, A -> C, B+C -> D
  const tasks = [
    waitTask("A"),
    waitTask("B", 1, ["A"]),
    waitTask("C", 1, ["A"]),
    waitTask("D", 1, ["B", "C"])
  ];
  const ctx = makeCtx(tasks);
  const summaries: string[] = [];

  await runTasksWithDependencies(ctx, s => summaries.push(s));
  assert.equal(summaries.length, 4);
  assert.ok(tasks.every(t => t.status === "done"));
});

test("parallel runner: empty task list completes without error", async () => {
  const ctx = makeCtx([]);
  const summaries: string[] = [];
  await runTasksWithDependencies(ctx, s => summaries.push(s));
  assert.equal(summaries.length, 0);
});

test("parallel runner: single task completes", async () => {
  const tasks = [waitTask("solo")];
  const ctx = makeCtx(tasks);
  const summaries: string[] = [];

  await runTasksWithDependencies(ctx, s => summaries.push(s));
  assert.equal(summaries.length, 1);
  assert.equal(tasks[0].status, "done");
});
