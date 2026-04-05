import test from "node:test";
import assert from "node:assert/strict";
import { detectExecutionMode } from "./telegram-bot";

test("detectExecutionMode: shell command → cli", () => {
  assert.equal(detectExecutionMode("ls -la"), "cli");
});

test("detectExecutionMode: git command → cli", () => {
  assert.equal(detectExecutionMode("git status"), "cli");
});

test("detectExecutionMode: 'go to' phrase → react", () => {
  assert.equal(detectExecutionMode("go to example.com"), "react");
});

test("detectExecutionMode: DSL open page → sequential", () => {
  assert.equal(detectExecutionMode('open page "https://x.com"'), "sequential");
});

test("detectExecutionMode: DSL click keyword → sequential", () => {
  assert.equal(detectExecutionMode('click the submit button'), "sequential");
});

test("detectExecutionMode: ambiguous natural language → react (default)", () => {
  assert.equal(detectExecutionMode("find the weather"), "react");
});

test("detectExecutionMode: URL without 'go to' → react", () => {
  assert.equal(detectExecutionMode("check https://example.com/status"), "react");
});

test("detectExecutionMode: npm command → cli", () => {
  assert.equal(detectExecutionMode("npm install lodash"), "cli");
});
