import test from "node:test";
import assert from "node:assert/strict";
import { publish, subscribe, request, reply, setShared, getShared, listSharedKeys, getRecentMessages, clearBus } from "./message-bus";

test("publish/subscribe delivers messages", () => {
  clearBus();
  const received: any[] = [];
  subscribe("test.event", (msg) => { received.push(msg); });
  publish({ topic: "test.event", from: "a", content: { x: 1 }, type: "event" });
  assert.equal(received.length, 1);
  assert.equal(received[0].from, "a");
  assert.deepEqual(received[0].content, { x: 1 });
});

test("broadcast subscribe gets all topics", () => {
  clearBus();
  const received: any[] = [];
  subscribe("*", (msg) => { received.push(msg.topic); });
  publish({ topic: "a", from: "x", content: {}, type: "event" });
  publish({ topic: "b", from: "x", content: {}, type: "event" });
  assert.deepEqual(received.sort(), ["a", "b"]);
});

test("unsubscribe removes listener", () => {
  clearBus();
  const received: any[] = [];
  const unsub = subscribe("test", (msg) => { received.push(msg); });
  publish({ topic: "test", from: "x", content: {}, type: "event" });
  unsub();
  publish({ topic: "test", from: "x", content: {}, type: "event" });
  assert.equal(received.length, 1);
});

test("request/reply roundtrip", async () => {
  clearBus();
  subscribe("query", (msg) => {
    if (msg.type === "request") {
      reply(msg, "replier", { answer: 42 });
    }
  });
  const result = await request("query", "asker", "replier", { question: "meaning" }, 5000);
  assert.ok(result);
  assert.equal(result!.type, "reply");
  assert.deepEqual(result!.content, { answer: 42 });
});

test("request times out when no reply", async () => {
  clearBus();
  const result = await request("no-handler", "asker", "nobody", {}, 100);
  assert.equal(result, null);
});

test("shared store set/get", () => {
  clearBus();
  setShared("count", 42, "agent-a");
  assert.equal(getShared("count"), 42);
});

test("shared store emits event on update", () => {
  clearBus();
  const events: any[] = [];
  subscribe("shared.updated", (msg) => { events.push(msg.content); });
  setShared("key", "value", "agent-a");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { key: "key", value: "value" });
});

test("listSharedKeys returns all keys", () => {
  clearBus();
  setShared("a", 1, "x");
  setShared("b", 2, "x");
  const keys = listSharedKeys().sort();
  assert.deepEqual(keys, ["a", "b"]);
});

test("history is capped", () => {
  clearBus();
  for (let i = 0; i < 10; i++) {
    publish({ topic: "t", from: "x", content: i, type: "event" });
  }
  const recent = getRecentMessages(5);
  assert.equal(recent.length, 5);
  assert.equal(recent[4].content, 9);
});
