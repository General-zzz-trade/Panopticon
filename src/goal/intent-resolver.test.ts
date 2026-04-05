import test from "node:test";
import assert from "node:assert/strict";
import { resolveIntent } from "./intent-resolver";

// ── Login intent ─────────────────────────────────────────────────────────────

test("resolveIntent recognises login intent and infers state_reached criterion", () => {
  const result = resolveIntent("log in to the admin panel");
  assert.equal(result.originalGoal, "log in to the admin panel");
  assert.ok(result.confidence > 0, "confidence should be positive");
  const stateReached = result.inferredCriteria.find(
    (c) => c.type === "state_reached" && c.value === "authenticated"
  );
  assert.ok(stateReached, "should infer state_reached:authenticated");
});

test("resolveIntent recognises sign-in variant", () => {
  const result = resolveIntent("sign in with my credentials");
  const stateReached = result.inferredCriteria.find(
    (c) => c.type === "state_reached" && c.value === "authenticated"
  );
  assert.ok(stateReached);
});

// ── Search intent ────────────────────────────────────────────────────────────

test("resolveIntent recognises search intent", () => {
  const result = resolveIntent('search for "blue widgets"');
  assert.ok(result.confidence > 0);
  const elementCrit = result.inferredCriteria.find((c) => c.type === "element_exists");
  assert.ok(elementCrit, "should infer element_exists for search results");
  assert.ok(elementCrit!.value.includes("blue widgets"), "search results criterion should mention the query");
});

test("resolveIntent recognises find intent", () => {
  const result = resolveIntent("find the pricing page");
  assert.ok(result.inferredCriteria.length > 0);
});

// ── Navigate intent ──────────────────────────────────────────────────────────

test("resolveIntent recognises navigate to URL", () => {
  const result = resolveIntent("navigate to https://example.com/settings");
  const urlCrit = result.inferredCriteria.find((c) => c.type === "url_reached");
  assert.ok(urlCrit, "should infer url_reached");
  assert.equal(urlCrit!.value, "https://example.com/settings");
});

test("resolveIntent recognises go to", () => {
  const result = resolveIntent("go to https://app.io/dashboard");
  const urlCrit = result.inferredCriteria.find((c) => c.type === "url_reached");
  assert.ok(urlCrit);
  assert.equal(urlCrit!.value, "https://app.io/dashboard");
});

// ── Verify/check intent ──────────────────────────────────────────────────────

test("resolveIntent recognises verify intent with target", () => {
  const result = resolveIntent('verify that "Order Confirmed" is visible');
  const textCrit = result.inferredCriteria.find((c) => c.type === "text_present");
  assert.ok(textCrit, "should infer text_present");
  assert.equal(textCrit!.value, "Order Confirmed");
});

// ── Checkout intent ──────────────────────────────────────────────────────────

test("resolveIntent recognises checkout intent", () => {
  const result = resolveIntent("buy the premium plan");
  assert.ok(result.confidence > 0);
  const stateReached = result.inferredCriteria.find(
    (c) => c.type === "state_reached" && c.value === "order_placed"
  );
  assert.ok(stateReached, "should infer state_reached:order_placed");
});

// ── Form / register intent ───────────────────────────────────────────────────

test("resolveIntent recognises form submission intent", () => {
  const result = resolveIntent("fill out the registration form");
  const stateReached = result.inferredCriteria.find(
    (c) => c.type === "state_reached" && c.value === "form_submitted"
  );
  assert.ok(stateReached);
});

// ── Unknown intents ──────────────────────────────────────────────────────────

test("resolveIntent preserves original goal for unknown intents", () => {
  const result = resolveIntent("make the website more colourful");
  // resolvedGoal always contains the original goal text (may have template hints appended)
  assert.ok(result.resolvedGoal.includes("make the website more colourful"));
});

test("resolveIntent returns original goal for a random sentence", () => {
  const result = resolveIntent("the quick brown fox jumps over the lazy dog");
  assert.ok(result.resolvedGoal.includes("the quick brown fox"));
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test("resolveIntent handles empty goal", () => {
  const result = resolveIntent("");
  assert.equal(result.confidence, 0);
  assert.equal(result.inferredCriteria.length, 0);
});

test("resolveIntent handles whitespace-only goal", () => {
  const result = resolveIntent("   ");
  assert.equal(result.confidence, 0);
});
