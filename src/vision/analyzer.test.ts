import { test } from "node:test";
import assert from "node:assert/strict";

// Test the vision analyzer's graceful degradation when no API key is configured
// (avoids needing a real vision API in CI)

test("visuallyLocateElement: returns low-confidence result when not configured", async () => {
  // Ensure no vision env vars
  delete process.env.LLM_VISION_API_KEY;
  delete process.env.LLM_VISION_BASE_URL;

  const { visuallyLocateElement } = await import("./analyzer");
  const result = await visuallyLocateElement("fake-base64", "the login button");

  assert.equal(result.confidence, "low");
  assert.equal(result.visible, false);
  assert.ok(result.description.includes("not configured") || result.description.includes("Vision LLM"));
});

test("visuallyAssert: returns failed result when not configured", async () => {
  delete process.env.LLM_VISION_API_KEY;
  delete process.env.LLM_VISION_BASE_URL;

  const { visuallyAssert } = await import("./analyzer");
  const result = await visuallyAssert("fake-base64", "Dashboard is visible");

  assert.equal(result.passed, false);
  assert.ok(result.found.includes("not configured") || result.found.length > 0);
});
