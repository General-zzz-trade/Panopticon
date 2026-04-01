import test from "node:test";
import assert from "node:assert/strict";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { planTasks } from "./planner";

test("planner smoke: success", async () => {
  const server = await startProviderServer((_request, response) => {
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tasks: [{ type: "open_page", payload: { url: "https://example.com" } }] }) } }] }));
  });
  await withPlannerEnv(server.url, async () => {
    const result = await planTasks('open "https://example.com"', { runId: "planner-success", mode: "llm", maxLLMPlannerCalls: 1 });
    assert.equal(result.plannerUsed, "llm");
  });
  await server.close();
});

test("planner smoke: timeout", async () => {
  const server = await startProviderServer(async (_request, response) => { await delay(200); response.end(JSON.stringify({ choices: [] })); });
  await withPlannerEnv(server.url, async () => {
    process.env.LLM_PLANNER_TIMEOUT_MS = "50";
    const result = await planTasks('open "https://example.com"', { runId: "planner-timeout", mode: "llm", maxLLMPlannerCalls: 1 });
    assert.equal(result.decisionTrace.timeoutCount, 1);
  });
  await server.close();
});

test("planner smoke: empty response", async () => {
  const server = await startProviderServer((_request, response) => { response.end(JSON.stringify({ choices: [{ message: { content: "" } }] })); });
  await withPlannerEnv(server.url, async () => {
    const result = await planTasks('open "https://example.com"', { runId: "planner-empty", mode: "llm", maxLLMPlannerCalls: 1 });
    assert.equal(result.plannerUsed, "none");
  });
  await server.close();
});

test("planner smoke: invalid json", async () => {
  const server = await startProviderServer((_request, response) => { response.end(JSON.stringify({ choices: [{ message: { content: "{bad" } }] })); });
  await withPlannerEnv(server.url, async () => {
    const result = await planTasks('open "https://example.com"', { runId: "planner-invalid", mode: "llm", maxLLMPlannerCalls: 1 });
    assert.equal(result.plannerUsed, "none");
  });
  await server.close();
});

test("planner smoke: low-quality fallback", async () => {
  const server = await startProviderServer((_request, response) => {
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tasks: [{ type: "screenshot", payload: { outputPath: "artifacts/only.png" } }] }) } }] }));
  });
  await withPlannerEnv(server.url, async () => {
    const result = await planTasks('launch local app using "npm run dev" then wait until "http://localhost:3000" is ready and open "http://localhost:3000" and confirm "Dashboard" appears then capture screenshot', {
      runId: "planner-low",
      mode: "auto",
      maxLLMPlannerCalls: 1,
      policy: { plannerCostMode: "aggressive", replannerCostMode: "balanced", preferRuleSystemsOnCheapGoals: false, allowLLMReplannerForSimpleFailures: false }
    });
    assert.notEqual(result.plannerUsed, "llm");
  });
  await server.close();
});

async function withPlannerEnv(url: string, fn: () => Promise<void>): Promise<void> { process.env.LLM_PLANNER_PROVIDER = "openai-compatible"; process.env.LLM_PLANNER_MODEL = "smoke"; process.env.LLM_PLANNER_API_KEY = "key"; process.env.LLM_PLANNER_BASE_URL = url; process.env.LLM_PLANNER_TIMEOUT_MS = "500"; try { await fn(); } finally { delete process.env.LLM_PLANNER_PROVIDER; delete process.env.LLM_PLANNER_MODEL; delete process.env.LLM_PLANNER_API_KEY; delete process.env.LLM_PLANNER_BASE_URL; delete process.env.LLM_PLANNER_TIMEOUT_MS; } }
async function startProviderServer(handler: (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => void | Promise<void>): Promise<{ url: string; close: () => Promise<void> }> { const server = createServer((request, response) => { response.setHeader("content-type", "application/json"); void handler(request, response); }); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Failed"); return { url: `http://127.0.0.1:${address.port}`, close: async () => { await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))); } }; }
function delay(durationMs: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, durationMs)); }
