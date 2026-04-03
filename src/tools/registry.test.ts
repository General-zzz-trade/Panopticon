import test from "node:test";
import assert from "node:assert/strict";
import {
  registerTool,
  unregisterTool,
  getTool,
  listTools,
  listToolsByCategory,
  getVerificationStrategy,
  toolRequiresApproval,
  isToolMutating,
  getCapabilitySummary,
  type ToolDefinition
} from "./registry";

test("built-in tools are registered on load", () => {
  const tools = listTools();
  assert.ok(tools.length >= 19, `Expected >= 19 built-in tools, got ${tools.length}`);
  assert.ok(getTool("click"));
  assert.ok(getTool("open_page"));
  assert.ok(getTool("run_code"));
});

test("getTool returns correct definition", () => {
  const tool = getTool("click");
  assert.ok(tool);
  assert.equal(tool!.category, "browser");
  assert.equal(tool!.mutating, true);
  assert.equal(tool!.verificationStrategy, "anomaly");
});

test("registerTool adds custom tool", () => {
  const custom: ToolDefinition = {
    name: "sql_query",
    category: "custom",
    description: "Execute a SQL query",
    parameters: [{ name: "query", type: "string", required: true, description: "SQL query" }],
    verificationStrategy: "error",
    mutating: false,
    requiresApproval: true
  };
  registerTool(custom);
  const retrieved = getTool("sql_query");
  assert.ok(retrieved);
  assert.equal(retrieved!.category, "custom");
  assert.equal(retrieved!.requiresApproval, true);
  // Cleanup
  unregisterTool("sql_query");
});

test("unregisterTool removes tool", () => {
  registerTool({
    name: "temp_tool", category: "custom", description: "temp",
    parameters: [], verificationStrategy: "error", mutating: false, requiresApproval: false
  });
  assert.ok(getTool("temp_tool"));
  assert.equal(unregisterTool("temp_tool"), true);
  assert.equal(getTool("temp_tool"), undefined);
});

test("unregisterTool returns false for unknown tool", () => {
  assert.equal(unregisterTool("nonexistent"), false);
});

test("listToolsByCategory returns correct subset", () => {
  const browserTools = listToolsByCategory("browser");
  assert.ok(browserTools.length >= 8);
  assert.ok(browserTools.every(t => t.category === "browser"));

  const visionTools = listToolsByCategory("vision");
  assert.ok(visionTools.length >= 4);
});

test("getVerificationStrategy returns correct strategy", () => {
  assert.equal(getVerificationStrategy("click"), "anomaly");
  assert.equal(getVerificationStrategy("assert_text"), "output");
  assert.equal(getVerificationStrategy("start_app"), "state");
  assert.equal(getVerificationStrategy("run_code"), "error");
});

test("getVerificationStrategy returns error for unknown tool", () => {
  assert.equal(getVerificationStrategy("unknown_tool"), "error");
});

test("toolRequiresApproval for dangerous tools", () => {
  assert.equal(toolRequiresApproval("run_code"), true);
  assert.equal(toolRequiresApproval("write_file"), true);
  assert.equal(toolRequiresApproval("click"), false);
});

test("isToolMutating identifies mutating tools", () => {
  assert.equal(isToolMutating("click"), true);
  assert.equal(isToolMutating("assert_text"), false);
  assert.equal(isToolMutating("screenshot"), false);
  assert.equal(isToolMutating("open_page"), true);
});

test("getCapabilitySummary groups by category", () => {
  const summary = getCapabilitySummary();
  assert.ok(summary.browser.includes("click"));
  assert.ok(summary.vision.includes("visual_click"));
  assert.ok(summary.shell.includes("start_app"));
  assert.ok(summary.code.includes("run_code"));
});

test("registerTool overwrites existing tool", () => {
  const original = getTool("click");
  assert.equal(original!.requiresApproval, false);

  registerTool({ ...original!, requiresApproval: true });
  assert.equal(getTool("click")!.requiresApproval, true);

  // Restore
  registerTool({ ...original!, requiresApproval: false });
});
