import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeGoal, isSafeSelector } from "./sanitize";

test("sanitizeGoal: strips null bytes", () => {
  assert.equal(sanitizeGoal("click\x00 button"), "click button");
});

test("sanitizeGoal: strips control characters", () => {
  assert.equal(sanitizeGoal("click\x01\x02button"), "clickbutton");
});

test("sanitizeGoal: preserves normal text", () => {
  assert.equal(sanitizeGoal('open page "http://localhost" and click "Login"'), 'open page "http://localhost" and click "Login"');
});

test("sanitizeGoal: trims whitespace", () => {
  assert.equal(sanitizeGoal("  click button  "), "click button");
});

test("sanitizeGoal: truncates to 2000 chars", () => {
  const long = "a".repeat(3000);
  assert.equal(sanitizeGoal(long).length, 2000);
});

test("isSafeSelector: valid selectors pass", () => {
  assert.ok(isSafeSelector("#login-button"));
  assert.ok(isSafeSelector(".nav > button"));
  assert.ok(isSafeSelector("[data-testid='submit']"));
  assert.ok(isSafeSelector("text=Login"));
});

test("isSafeSelector: rejects empty", () => {
  assert.equal(isSafeSelector(""), false);
});

test("isSafeSelector: rejects HTML tags", () => {
  assert.equal(isSafeSelector("<script>alert(1)</script>"), false);
});

test("isSafeSelector: rejects javascript: protocol", () => {
  assert.equal(isSafeSelector("javascript:alert(1)"), false);
});

test("isSafeSelector: rejects selectors over 500 chars", () => {
  assert.equal(isSafeSelector("a".repeat(501)), false);
});
