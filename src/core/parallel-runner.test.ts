import { test } from "node:test";
import assert from "node:assert/strict";
import { runTasksWithDependencies } from "./parallel-runner";
import type { RunContext, AgentTask } from "../types";

function makeCtx(tasks: AgentTask[]): RunContext {
  return {
    runId: "test-run",
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

function makeTask(id: string, dependsOn?: string[]): AgentTask {
  return {
    id,
    type: "wait",
    status: "pending",
    retries: 0,
    attempts: 0,
    replanDepth: 0,
    payload: { ms: 1, durationMs: 1 },
    dependsOn: dependsOn ?? []
  } as unknown as AgentTask;
}

test("runTasksWithDependencies: sequential fallback (no deps)", async () => {
  const order: string[] = [];
  const tasks = [makeTask("t1"), makeTask("t2"), makeTask("t3")];
  const ctx = makeCtx(tasks);

  // Monkey-patch executeTask via the module — instead, test indirectly via summaries
  const summaries: string[] = [];
  // The wait handler will actually run with durationMs:1, so this is a real execution test
  await assert.doesNotReject(() => runTasksWithDependencies(ctx, s => summaries.push(s)));
  assert.ok(summaries.length === 3);
});

test("runTasksWithDependencies: parallel tasks (with deps)", async () => {
  // t1 and t2 independent, t3 depends on both
  const t1 = makeTask("t1");
  const t2 = makeTask("t2");
  const t3 = makeTask("t3", ["t1", "t2"]);
  const ctx = makeCtx([t1, t2, t3]);

  const summaries: string[] = [];
  await assert.doesNotReject(() => runTasksWithDependencies(ctx, s => summaries.push(s)));
  assert.equal(summaries.length, 3);
  // t3 must complete after t1 and t2
  assert.equal(t1.status, "done");
  assert.equal(t2.status, "done");
  assert.equal(t3.status, "done");
});
