/**
 * Tests for visual action parsing in the regex planner
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegexPlan } from "../planner/regex-planner";

test("visual_click: quoted description", () => {
  const plan = createRegexPlan('visually click "the Login button"');
  assert.equal(plan.length, 1);
  assert.equal(plan[0].type, "visual_click");
  assert.equal(plan[0].payload["description"], "the Login button");
});

test("visual_click: 'visual click' keyword", () => {
  const plan = createRegexPlan('visual click "Submit"');
  assert.equal(plan[0].type, "visual_click");
  assert.equal(plan[0].payload["description"], "Submit");
});

test("visual_type: quoted text and description", () => {
  const plan = createRegexPlan('visually type "Alice" into "the username field"');
  assert.equal(plan[0].type, "visual_type");
  assert.equal(plan[0].payload["text"], "Alice");
  assert.equal(plan[0].payload["description"], "the username field");
});

test("visual_assert: quoted assertion", () => {
  const plan = createRegexPlan('visually assert "Dashboard is visible"');
  assert.equal(plan[0].type, "visual_assert");
  assert.equal(plan[0].payload["assertion"], "Dashboard is visible");
});

test("visual_extract: quoted description", () => {
  const plan = createRegexPlan('visually extract "the page title"');
  assert.equal(plan[0].type, "visual_extract");
  assert.equal(plan[0].payload["description"], "the page title");
});

test("visual actions in compound goal", () => {
  const plan = createRegexPlan(
    'open page "http://localhost" and visually click "Login" and visually assert "Dashboard visible" and screenshot'
  );
  assert.equal(plan[0].type, "open_page");
  assert.equal(plan[1].type, "visual_click");
  assert.equal(plan[2].type, "visual_assert");
  assert.equal(plan[3].type, "screenshot");
});
