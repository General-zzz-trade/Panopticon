import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  loadProgram,
  saveProgram,
  getDefaultProgram,
  composeGoalWithProgram,
  computeScore,
  parseEditProposal,
  type TaskResult,
  type SelfImprovingOptions,
  type Generation
} from "./self-improving";

function tmpProgramPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "self-improving-"));
  return path.join(dir, "program.md");
}

test("loadProgram/saveProgram round-trip", () => {
  const p = tmpProgramPath();
  const content = "# Hello\nline one\nline two\n";
  saveProgram(p, content);
  const loaded = loadProgram(p);
  assert.equal(loaded, content);
});

test("loadProgram returns empty string for missing file", () => {
  const p = path.join(os.tmpdir(), `does-not-exist-${Date.now()}.md`);
  assert.equal(loadProgram(p), "");
});

test("saveProgram creates parent directories", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "self-improving-"));
  const nested = path.join(dir, "a", "b", "c", "program.md");
  saveProgram(nested, "x");
  assert.equal(loadProgram(nested), "x");
});

test("getDefaultProgram returns non-empty content", () => {
  const def = getDefaultProgram();
  assert.ok(typeof def === "string");
  assert.ok(def.length > 50);
  assert.match(def, /Strategies/);
});

test("composeGoalWithProgram prepends program context", () => {
  const composed = composeGoalWithProgram("- be careful", "click login");
  assert.match(composed, /Following these strategies:/);
  assert.match(composed, /- be careful/);
  assert.match(composed, /Task: click login/);
});

test("composeGoalWithProgram returns bare goal when program is empty", () => {
  assert.equal(composeGoalWithProgram("", "do thing"), "do thing");
  assert.equal(composeGoalWithProgram("   \n  ", "do thing"), "do thing");
});

test("computeScore averages task results", () => {
  const none: TaskResult[] = [];
  assert.equal(computeScore(none), 0);

  const all: TaskResult[] = [
    { taskGoal: "a", success: true, durationMs: 1 },
    { taskGoal: "b", success: true, durationMs: 1 }
  ];
  assert.equal(computeScore(all), 1);

  const half: TaskResult[] = [
    { taskGoal: "a", success: true, durationMs: 1 },
    { taskGoal: "b", success: false, durationMs: 1 }
  ];
  assert.equal(computeScore(half), 0.5);
});

test("parseEditProposal parses bare JSON", () => {
  const raw = '{"edit_description":"add rule","new_content":"# v2\\n- rule"}';
  const p = parseEditProposal(raw);
  assert.ok(p);
  assert.equal(p!.editDescription, "add rule");
  assert.equal(p!.newContent, "# v2\n- rule");
});

test("parseEditProposal strips markdown fences", () => {
  const raw = '```json\n{"edit_description":"x","new_content":"hi"}\n```';
  const p = parseEditProposal(raw);
  assert.ok(p);
  assert.equal(p!.newContent, "hi");
});

test("parseEditProposal finds JSON inside prose", () => {
  const raw = 'Here is my proposal: {"edit_description":"a","new_content":"b"} done.';
  const p = parseEditProposal(raw);
  assert.ok(p);
  assert.equal(p!.editDescription, "a");
  assert.equal(p!.newContent, "b");
});

test("parseEditProposal returns null on missing new_content", () => {
  assert.equal(parseEditProposal('{"edit_description":"x"}'), null);
  assert.equal(parseEditProposal("not json at all"), null);
  assert.equal(parseEditProposal(""), null);
});

test("parseEditProposal handles nested braces and quoted strings", () => {
  const raw = '{"edit_description":"uses {braces} and \\"quotes\\"","new_content":"body {\\n  x: 1\\n}"}';
  const p = parseEditProposal(raw);
  assert.ok(p);
  assert.equal(p!.newContent, "body {\n  x: 1\n}");
});

test("evaluationTasks array is respected (SelfImprovingOptions shape)", () => {
  // Verify the option type supports the expected fields without executing runGoal
  const opts: SelfImprovingOptions = {
    initialProgram: "x",
    evaluationTasks: ["task a", "task b", "task c"],
    maxGenerations: 3
  };
  assert.equal(opts.evaluationTasks.length, 3);
  assert.equal(opts.evaluationTasks[0], "task a");
});

test("Generation number increments correctly", () => {
  // Simulate what runSelfImproving records per generation
  const gens: Generation[] = [];
  for (let i = 0; i < 4; i++) {
    gens.push({
      number: i,
      programContent: `v${i}`,
      taskResults: [],
      score: i / 4,
      editAccepted: i === 0,
      createdAt: new Date().toISOString()
    });
  }
  assert.equal(gens.length, 4);
  for (let i = 0; i < gens.length; i++) {
    assert.equal(gens[i].number, i);
  }
});
