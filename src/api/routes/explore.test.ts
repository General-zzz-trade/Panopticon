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

test("POST /api/v1/explore returns exploration plan", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/explore",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "http://example.com" })
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.url, "http://example.com");
  assert.ok(typeof body.plannedActions === "number");
  assert.ok(Array.isArray(body.actions));
  assert.ok(body.config, "response should include config");
});

test("POST /api/v1/explore accepts custom config", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/explore",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "http://example.com", maxSteps: 5, maxDepth: 2 })
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.config.maxSteps, 5);
  assert.equal(body.config.maxDepth, 2);
});

test("POST /api/v1/explore rejects missing url", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/explore",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(res.statusCode, 400);
});

test("POST /api/v1/explore rejects empty url", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/explore",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "" })
  });
  assert.equal(res.statusCode, 400);
});

test("POST /api/v1/explore config includes timeout", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/explore",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "http://example.com" })
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(typeof body.config.timeout === "number", "config should include timeout");
  assert.ok(typeof body.config.maxSteps === "number", "config should include maxSteps");
  assert.ok(typeof body.config.maxDepth === "number", "config should include maxDepth");
});

test("POST /api/v1/explore uses defaults when no config provided", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/explore",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "http://example.com" })
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  // Default values should be present and reasonable
  assert.ok(body.config.maxSteps > 0, "default maxSteps should be positive");
  assert.ok(body.config.maxDepth > 0, "default maxDepth should be positive");
});
