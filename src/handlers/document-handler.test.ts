import { test } from "node:test";
import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";
import { handleDocumentTask } from "./document-handler";
import type { RunContext, AgentTask } from "../types";

const CSV_PATH = "/tmp/test-agent.csv";

function makeCtx(): RunContext {
  return {
    runId: "test-run",
    goal: "test",
    tasks: [],
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: 0,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    escalationDecisions: [],
    limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 },
    startedAt: new Date().toISOString()
  } as unknown as RunContext;
}

function makeTask(action: string, payload: Record<string, string | number | boolean | undefined>): AgentTask {
  return {
    id: "task-doc-1",
    type: "run_code" as const,
    status: "pending" as const,
    retries: 0,
    attempts: 0,
    replanDepth: 0,
    payload: { action, ...payload }
  };
}

test("document-handler: CSV round-trip (write then read)", async () => {
  const ctx = makeCtx();

  // Write a CSV with 3 rows
  const writeTask = makeTask("write_csv", {
    path: CSV_PATH,
    headers: JSON.stringify(["name", "age", "city"]),
    rows: JSON.stringify([
      ["Alice", "30", "NYC"],
      ["Bob", "25", "LA"],
      ["Carol", "35", "Chicago"]
    ])
  });

  const writeResult = await handleDocumentTask(ctx, writeTask);
  assert.ok(writeResult.summary.includes("write_csv"), "write summary should mention write_csv");

  // Read it back
  const readTask = makeTask("read_csv", { path: CSV_PATH });
  readTask.id = "task-doc-2";
  const readResult = await handleDocumentTask(ctx, readTask);

  assert.ok(readResult.summary.includes("read_csv"), "read summary should mention read_csv");
  assert.ok(readResult.summary.includes("rowCount"), "read summary should contain rowCount");
  // Verify 3 rows were read back
  assert.ok(readResult.summary.includes('"rowCount":3') || readResult.summary.includes("rowCount\": 3"),
    "should report 3 rows");

  // Cleanup
  try { unlinkSync(CSV_PATH); } catch { /* ignore */ }
});

test("document-handler: read_csv missing path throws", async () => {
  const ctx = makeCtx();
  const task = makeTask("read_csv", { path: undefined });
  await assert.rejects(() => handleDocumentTask(ctx, task), /path payload is required/);
});

test("document-handler: write_csv missing headers throws", async () => {
  const ctx = makeCtx();
  const task = makeTask("write_csv", { path: "/tmp/no-headers.csv" });
  await assert.rejects(() => handleDocumentTask(ctx, task), /headers payload is required/);
});

test("document-handler: unknown action throws", async () => {
  const ctx = makeCtx();
  const task = makeTask("read_docx", { path: "/tmp/test.docx" });
  await assert.rejects(() => handleDocumentTask(ctx, task), /unknown action/);
});
