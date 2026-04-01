import { test } from "node:test";
import assert from "node:assert/strict";
import { maskSensitive, isDangerousGoal, checkRateLimit } from "./security";

test("maskSensitive: masks password field", () => {
  const masked = maskSensitive('{"password": "secret123"}');
  assert.ok(!masked.includes("secret123"));
  assert.ok(masked.includes("***"));
});

test("maskSensitive: masks Bearer token", () => {
  const masked = maskSensitive("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def");
  assert.ok(!masked.includes("eyJhbGci"));
  assert.ok(masked.includes("Bearer ***"));
});

test("maskSensitive: leaves normal text unchanged", () => {
  const text = "open http://example.com and click login";
  assert.equal(maskSensitive(text), text);
});

test("isDangerousGoal: flags delete keyword", () => {
  const r = isDangerousGoal("delete all users from the database");
  assert.equal(r.dangerous, true);
  assert.ok(r.reason?.includes("delete"));
});

test("isDangerousGoal: flags payment keyword", () => {
  assert.equal(isDangerousGoal("complete the payment checkout").dangerous, true);
});

test("isDangerousGoal: normal goal is safe", () => {
  assert.equal(isDangerousGoal("open http://example.com and click login").dangerous, false);
});

test("checkRateLimit: allows under burst limit", () => {
  const ip = `test-ip-${Math.random()}`;
  for (let i = 0; i < 10; i++) assert.ok(checkRateLimit(ip));
});

test("checkRateLimit: blocks after burst exhausted", () => {
  const ip = `burst-ip-${Math.random()}`;
  // Exhaust all 50 burst tokens
  for (let i = 0; i < 50; i++) checkRateLimit(ip);
  assert.equal(checkRateLimit(ip), false);
});
