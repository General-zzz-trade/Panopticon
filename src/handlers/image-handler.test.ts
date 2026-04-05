import { test } from "node:test";
import assert from "node:assert/strict";
import { isImageAnalysisAvailable, getMimeType } from "./image-handler";

test("isImageAnalysisAvailable returns false without API key", () => {
  // Save and clear relevant env vars
  const savedVision = process.env.LLM_VISION_API_KEY;
  const savedAnthropic = process.env.ANTHROPIC_API_KEY;
  delete process.env.LLM_VISION_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    assert.equal(isImageAnalysisAvailable(), false);
  } finally {
    // Restore env vars
    if (savedVision !== undefined) process.env.LLM_VISION_API_KEY = savedVision;
    if (savedAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = savedAnthropic;
  }
});

test("getMimeType returns correct types for png/jpg/gif", () => {
  assert.equal(getMimeType("screenshot.png"), "image/png");
  assert.equal(getMimeType("photo.jpg"), "image/jpeg");
  assert.equal(getMimeType("photo.jpeg"), "image/jpeg");
  assert.equal(getMimeType("animation.gif"), "image/gif");
  assert.equal(getMimeType("modern.webp"), "image/webp");
  // Unknown extension defaults to image/png
  assert.equal(getMimeType("file.bmp"), "image/png");
});
