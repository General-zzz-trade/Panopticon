import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../server";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

before(async () => {
  process.env.AGENT_API_AUTH = "false";
  app = await buildServer();
  await app.ready();
});

after(async () => {
  await app.close();
});

test("POST /api/v1/coordinate decomposes parallel goal", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/coordinate",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "test login, registration, and profile" })
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.strategy, "parallel");
  assert.ok(body.workers.length >= 3, "should decompose into at least 3 workers");
  assert.ok(Array.isArray(body.readyWorkers));
  assert.ok(body.originalGoal);
});

test("POST /api/v1/coordinate returns single for simple goal", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/coordinate",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "open the dashboard" })
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.strategy, "single");
  assert.equal(body.workers.length, 1);
});

test("POST /api/v1/coordinate rejects empty goal", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/coordinate",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "" })
  });
  assert.equal(res.statusCode, 400);
});

test("POST /api/v1/coordinate rejects missing goal", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/coordinate",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(res.statusCode, 400);
});

test("POST /api/v1/coordinate workers have id and goal fields", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/coordinate",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "test login and registration" })
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  for (const worker of body.workers) {
    assert.ok(worker.id, "each worker should have an id");
    assert.ok(worker.goal, "each worker should have a goal");
    assert.ok(worker.status, "each worker should have a status");
  }
});

test("POST /api/v1/coordinate returns dependencies map", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/coordinate",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "test login and then view dashboard" })
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(typeof body.dependencies === "object", "should include dependencies");
});
