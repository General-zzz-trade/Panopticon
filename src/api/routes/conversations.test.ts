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

test("POST /api/v1/conversations creates a new conversation", async () => {
  const res = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.ok(body.id, "response should include an id");
  assert.ok(body.createdAt, "response should include createdAt");
});

test("GET /api/v1/conversations lists conversations", async () => {
  // Create one first to ensure list is non-empty
  await app.inject({ method: "POST", url: "/api/v1/conversations" });

  const res = await app.inject({ method: "GET", url: "/api/v1/conversations" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(Array.isArray(body.conversations), "conversations should be an array");
  assert.ok(body.conversations.length >= 1, "should have at least one conversation");

  const first = body.conversations[0];
  assert.ok(first.id);
  assert.ok(typeof first.turns === "number");
  assert.ok(first.createdAt);
});

test("GET /api/v1/conversations/:id returns conversation details", async () => {
  const createRes = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  const { id } = JSON.parse(createRes.body);

  const res = await app.inject({ method: "GET", url: `/api/v1/conversations/${id}` });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.id, id);
  assert.ok(Array.isArray(body.turns));
  assert.ok(body.createdAt);
});

test("GET /api/v1/conversations/:id returns 404 for unknown id", async () => {
  const res = await app.inject({ method: "GET", url: "/api/v1/conversations/nonexistent" });
  assert.equal(res.statusCode, 404);
  const body = JSON.parse(res.body);
  assert.ok(body.error);
});

test("DELETE /api/v1/conversations/:id returns 404 for unknown id", async () => {
  const res = await app.inject({ method: "DELETE", url: "/api/v1/conversations/nonexistent" });
  assert.equal(res.statusCode, 404);
  const body = JSON.parse(res.body);
  assert.ok(body.error);
});

test("DELETE /api/v1/conversations/:id removes conversation", async () => {
  const createRes = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  const { id } = JSON.parse(createRes.body);

  const delRes = await app.inject({ method: "DELETE", url: `/api/v1/conversations/${id}` });
  assert.equal(delRes.statusCode, 204);

  // Verify it's gone
  const getRes = await app.inject({ method: "GET", url: `/api/v1/conversations/${id}` });
  assert.equal(getRes.statusCode, 404);
});

test("POST /api/v1/conversations returns unique ids", async () => {
  const res1 = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  const res2 = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  const id1 = JSON.parse(res1.body).id;
  const id2 = JSON.parse(res2.body).id;
  assert.notEqual(id1, id2, "each conversation should have a unique id");
});
