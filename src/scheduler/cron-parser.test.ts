// Tests use local-time getHours()/getMinutes(), so pin to UTC for determinism
process.env["TZ"] = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import { nextCronDate, validateCronExpr } from "./cron-parser";

test("every minute: next is 1 min ahead", () => {
  const from = new Date("2026-01-01T10:00:00Z");
  const next = nextCronDate("* * * * *", from);
  assert.equal(next.getMinutes(), 1);
  assert.equal(next.getHours(), 10);
});

test("@daily: fires at midnight", () => {
  const from = new Date("2026-01-01T10:00:00Z");
  const next = nextCronDate("@daily", from);
  assert.equal(next.getHours(), 0);
  assert.equal(next.getMinutes(), 0);
});

test("specific minute: 0 9 * * * fires at 09:00", () => {
  const from = new Date("2026-01-01T08:00:00Z");
  const next = nextCronDate("0 9 * * *", from);
  assert.equal(next.getHours(), 9);
  assert.equal(next.getMinutes(), 0);
});

test("validateCronExpr: valid expression", () => {
  assert.equal(validateCronExpr("0 9 * * *").valid, true);
});

test("validateCronExpr: invalid expression", () => {
  assert.equal(validateCronExpr("not a cron").valid, false);
});

test("validateCronExpr: @hourly alias is valid", () => {
  assert.equal(validateCronExpr("@hourly").valid, true);
});

test("step expression */5: fires every 5 minutes", () => {
  const from = new Date("2026-01-01T10:00:00Z");
  const next = nextCronDate("*/5 * * * *", from);
  assert.equal(next.getMinutes() % 5, 0);
});
