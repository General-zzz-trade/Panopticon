import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerPlugin, unregisterPlugin, getActionHandler, listPlugins, clearPlugins, getRegisteredActionTypes } from "./registry";
import type { AgentPlugin } from "./types";

const mockPlugin: AgentPlugin = {
  name: "test-plugin",
  version: "1.0.0",
  actions: [
    {
      type: "call_api",
      description: "Call an external HTTP API",
      payloadSchema: { url: "string", method: "string" },
      execute: async (_ctx, task) => ({ summary: `Called API: ${task.payload["url"]}` })
    }
  ]
};

beforeEach(() => clearPlugins());

test("registerPlugin: registers action handler", () => {
  registerPlugin(mockPlugin);
  const handler = getActionHandler("call_api");
  assert.ok(handler);
  assert.equal(handler?.type, "call_api");
});

test("registerPlugin: throws on duplicate plugin name", () => {
  registerPlugin(mockPlugin);
  assert.throws(() => registerPlugin(mockPlugin), /already registered/);
});

test("registerPlugin: throws on duplicate action type", () => {
  registerPlugin(mockPlugin);
  assert.throws(() => registerPlugin({ name: "other-plugin", version: "1.0.0", actions: [mockPlugin.actions[0]] }), /already registered/);
});

test("unregisterPlugin: removes handlers", () => {
  registerPlugin(mockPlugin);
  unregisterPlugin("test-plugin");
  assert.equal(getActionHandler("call_api"), null);
});

test("listPlugins: returns plugin metadata", () => {
  registerPlugin(mockPlugin);
  const list = listPlugins();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "test-plugin");
  assert.deepEqual(list[0].actions, ["call_api"]);
});

test("getRegisteredActionTypes: returns all types", () => {
  registerPlugin(mockPlugin);
  const types = getRegisteredActionTypes();
  assert.ok(types.includes("call_api"));
});

test("getActionHandler: returns null for unknown type", () => {
  assert.equal(getActionHandler("nonexistent_type"), null);
});
