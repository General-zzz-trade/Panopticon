import test from "node:test";
import assert from "node:assert/strict";
import { getTool, getVerificationStrategy, toolRequiresApproval, isToolMutating } from "./registry";

test("registry provides parameter metadata for executor validation", () => {
  const clickTool = getTool("click");
  assert.ok(clickTool);
  assert.equal(clickTool!.parameters.length, 1);
  assert.equal(clickTool!.parameters[0].name, "selector");
  assert.equal(clickTool!.parameters[0].required, true);
});

test("registry identifies tools requiring approval", () => {
  assert.equal(toolRequiresApproval("run_code"), true);
  assert.equal(toolRequiresApproval("write_file"), true);
  assert.equal(toolRequiresApproval("click"), false);
  assert.equal(toolRequiresApproval("open_page"), false);
});

test("registry provides verification strategy for each task type", () => {
  assert.equal(getVerificationStrategy("click"), "anomaly");
  assert.equal(getVerificationStrategy("type"), "output");
  assert.equal(getVerificationStrategy("open_page"), "state");
  assert.equal(getVerificationStrategy("http_request"), "error");
  assert.equal(getVerificationStrategy("run_code"), "error");
});

test("registry identifies mutating vs read-only tools", () => {
  assert.equal(isToolMutating("click"), true);
  assert.equal(isToolMutating("screenshot"), false);
  assert.equal(isToolMutating("assert_text"), false);
  assert.equal(isToolMutating("write_file"), true);
  assert.equal(isToolMutating("read_file"), false);
});

test("all 20 built-in task types have registry definitions", () => {
  const expectedTypes = [
    "open_page", "click", "type", "select", "hover", "scroll",
    "wait", "screenshot", "assert_text",
    "visual_click", "visual_type", "visual_assert", "visual_extract",
    "start_app", "stop_app", "wait_for_server",
    "http_request", "read_file", "write_file", "run_code"
  ];

  for (const taskType of expectedTypes) {
    const tool = getTool(taskType);
    assert.ok(tool, `Expected registry definition for "${taskType}"`);
  }
});

test("type tool has both selector and value parameters", () => {
  const tool = getTool("type");
  assert.ok(tool);
  const paramNames = tool!.parameters.map(p => p.name);
  assert.ok(paramNames.includes("selector"));
  assert.ok(paramNames.includes("value"));
  assert.equal(tool!.parameters.find(p => p.name === "selector")!.required, true);
  assert.equal(tool!.parameters.find(p => p.name === "value")!.required, true);
});
