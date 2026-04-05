import test from "node:test";
import assert from "node:assert/strict";
import { buildToolExecutionCode, listSynthesizedTools, type SynthesizedTool } from "./synthesizer";
import type { ToolDefinition } from "./registry";

const mockDef: ToolDefinition = {
  name: "test_tool",
  category: "custom",
  description: "A test tool",
  parameters: [{ name: "input", type: "string", required: true, description: "Input value" }],
  verificationStrategy: "error",
  mutating: false,
  requiresApproval: true
};

test("buildToolExecutionCode wraps JS code with params", () => {
  const tool: SynthesizedTool = {
    definition: mockDef,
    code: 'const params = JSON.parse(process.argv[2]); console.log(JSON.stringify({success: true, result: params.input}));',
    language: "javascript",
    validated: true
  };

  const result = buildToolExecutionCode(tool, { input: "hello" });
  assert.equal(result.language, "javascript");
  assert.ok(result.code.includes('__params'));
  assert.ok(result.code.includes('"hello"'));
  assert.ok(!result.code.includes('process.argv[2]'));
});

test("buildToolExecutionCode wraps Python code with params", () => {
  const tool: SynthesizedTool = {
    definition: mockDef,
    code: 'print(json.dumps({"success": True, "result": __params["input"]}))',
    language: "python",
    validated: true
  };

  const result = buildToolExecutionCode(tool, { input: "world" });
  assert.equal(result.language, "python");
  assert.ok(result.code.includes("import json"));
  assert.ok(result.code.includes("world"));
});

test("listSynthesizedTools starts empty", () => {
  const tools = listSynthesizedTools();
  assert.ok(Array.isArray(tools));
});
