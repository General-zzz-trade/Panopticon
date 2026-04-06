import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getOrCreateEmitter,
  publishEvent,
  closeEmitter,
  hasEmitter,
  isClosed,
  getBufferedEvents
} from "./event-bus";

test("getOrCreateEmitter: creates emitter for new runId", () => {
  const emitter = getOrCreateEmitter("test-run-1");
  assert.ok(emitter);
  assert.ok(hasEmitter("test-run-1"));
  closeEmitter("test-run-1");
});

test("publishEvent: listeners receive events", (_, done) => {
  const emitter = getOrCreateEmitter("test-run-2");
  emitter.on("event", (evt) => {
    assert.equal(evt.type, "task_start");
    assert.equal(evt.runId, "test-run-2");
    assert.equal(typeof evt.seq, "number");
    closeEmitter("test-run-2");
    done();
  });
  publishEvent({ type: "task_start", runId: "test-run-2", timestamp: new Date().toISOString() });
});

test("closeEmitter: fires close event and marks bus closed", (_, done) => {
  const emitter = getOrCreateEmitter("test-run-3");
  emitter.once("close", () => {
    assert.equal(isClosed("test-run-3"), true);
    done();
  });
  closeEmitter("test-run-3");
});

test("publishEvent: auto-creates bus and buffers events", () => {
  publishEvent({ type: "log", runId: "test-run-4", timestamp: new Date().toISOString(), message: "hello" });
  const buffered = getBufferedEvents("test-run-4");
  assert.equal(buffered.length, 1);
  assert.equal(buffered[0].message, "hello");
  assert.equal(buffered[0].seq, 1);
  closeEmitter("test-run-4");
});

test("getBufferedEvents: replay since seq", () => {
  publishEvent({ type: "log", runId: "test-run-5", timestamp: new Date().toISOString(), message: "a" });
  publishEvent({ type: "log", runId: "test-run-5", timestamp: new Date().toISOString(), message: "b" });
  publishEvent({ type: "log", runId: "test-run-5", timestamp: new Date().toISOString(), message: "c" });
  const after1 = getBufferedEvents("test-run-5", 1);
  assert.equal(after1.length, 2);
  assert.equal(after1[0].message, "b");
  assert.equal(after1[1].message, "c");
  closeEmitter("test-run-5");
});
