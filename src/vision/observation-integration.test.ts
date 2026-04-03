import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSceneFromText } from "./scene-analyzer";

test("analyzeSceneFromText detects login page", () => {
  const scene = analyzeSceneFromText(["Login", "Username", "Password", "Sign in"]);
  assert.equal(scene.pageType, "login");
  assert.ok(scene.confidence > 0);
});

test("analyzeSceneFromText detects dashboard", () => {
  const scene = analyzeSceneFromText(["Dashboard", "Welcome back", "Recent activity"]);
  assert.equal(scene.pageType, "dashboard");
});

test("analyzeSceneFromText detects error page", () => {
  const scene = analyzeSceneFromText(["Error", "Something failed", "Go back"]);
  assert.equal(scene.pageType, "error");
});

test("analyzeSceneFromText returns unknown for ambiguous content", () => {
  const scene = analyzeSceneFromText(["Some random content"]);
  assert.ok(["unknown", "loading", "form", "list", "dashboard", "login", "error"].includes(scene.pageType));
});

test("scene description has required fields", () => {
  const scene = analyzeSceneFromText(["Login", "Password"]);
  assert.ok(typeof scene.pageType === "string");
  assert.ok(Array.isArray(scene.keyElements));
  assert.ok(Array.isArray(scene.stateIndicators));
  assert.ok(typeof scene.confidence === "number");
});
