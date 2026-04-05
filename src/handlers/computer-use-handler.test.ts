import test from "node:test";
import assert from "node:assert/strict";
import { isVisualFallbackAvailable } from "./computer-use-handler";

test("isVisualFallbackAvailable returns false when no API key", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  const original2 = process.env.LLM_RECOVERY_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.LLM_RECOVERY_API_KEY;
  assert.equal(isVisualFallbackAvailable(), false);
  if (original) process.env.ANTHROPIC_API_KEY = original;
  if (original2) process.env.LLM_RECOVERY_API_KEY = original2;
});

test("isVisualFallbackAvailable returns true when API key set", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  assert.equal(isVisualFallbackAvailable(), true);
  if (original) process.env.ANTHROPIC_API_KEY = original;
  else delete process.env.ANTHROPIC_API_KEY;
});
