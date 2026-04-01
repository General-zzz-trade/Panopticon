import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

before(async () => {
  // Disable auth for tests
  process.env.AGENT_API_AUTH = "false";
  app = await buildServer();
  await app.ready();
});

after(async () => {
  await app.close();
});

test("GET /health returns ok", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.status, "ok");
});

test("GET /api/v1/runs returns list with runs array", async () => {
  const res = await app.inject({ method: "GET", url: "/api/v1/runs" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(Array.isArray(body.runs));
  assert.ok(typeof body.limit === "number");
});

test("GET /api/v1/runs/:id returns 404 for unknown id", async () => {
  const res = await app.inject({ method: "GET", url: "/api/v1/runs/nonexistent-run-id-xyz" });
  assert.equal(res.statusCode, 404);
});

test("GET /api/v1/runs/:id/status returns 404 for unknown id", async () => {
  const res = await app.inject({ method: "GET", url: "/api/v1/runs/nonexistent-run-id-xyz/status" });
  assert.equal(res.statusCode, 404);
});

test("POST /api/v1/runs validates body: missing goal returns 400", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/v1/runs",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ options: {} })
  });
  assert.equal(res.statusCode, 400);
});

test("POST /api/v1/runs returns 202 with runId and pending status", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/v1/runs",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "wait 50ms" })
  });
  assert.equal(res.statusCode, 202);
  const body = JSON.parse(res.body);
  assert.ok(body.runId, "should have runId");
  assert.equal(body.status, "pending");
});

test("GET /queue/stats returns concurrency info", async () => {
  const res = await app.inject({ method: "GET", url: "/api/v1/queue/stats" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(typeof body.concurrency === "number");
  assert.ok(typeof body.running === "number");
  assert.ok(typeof body.pending === "number");
});

test("POST /api/v1/keys creates a key (auth bypass mode)", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/v1/keys",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "test-key" })
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.ok(body.key.startsWith("ak_"), "key should start with ak_");
});
