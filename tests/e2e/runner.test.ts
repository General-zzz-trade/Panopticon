import test, { describe, before } from "node:test";
import assert from "node:assert/strict";
import { nonBrowserScenarios, TestScenario } from "./scenarios";
import { matchTemplatePlan } from "../../src/planner/templates";

/**
 * Integration tests for non-browser scenarios.
 *
 * These tests validate that the template planner correctly matches
 * goal strings to task blueprints, and that the expected task types
 * are produced. They do not require Playwright or a running browser.
 */

describe("E2E Scenarios — template planner matching (non-browser)", () => {
  for (const scenario of nonBrowserScenarios) {
    test(`[${scenario.id}] ${scenario.name}`, { timeout: scenario.timeout }, () => {
      const plan = matchTemplatePlan(scenario.goal);

      assert.ok(
        plan !== null,
        `Template planner should produce a plan for goal: "${scenario.goal}"`
      );

      const actualTypes = plan.map((t) => t.type);

      assert.deepStrictEqual(
        actualTypes,
        scenario.expectedTaskTypes,
        `Task types mismatch for "${scenario.goal}". Got [${actualTypes.join(", ")}], expected [${scenario.expectedTaskTypes.join(", ")}]`
      );

      // Verify all tasks have a payload object
      for (const task of plan) {
        assert.ok(
          task.payload !== null && typeof task.payload === "object",
          `Task ${task.type} should have a payload object`
        );
      }
    });
  }
});

describe("E2E Scenarios — template planner matching (browser scenarios, plan-only)", () => {
  // We only validate that the planner produces correct task types,
  // not that the browser actions succeed.
  const browserPlanScenarios: TestScenario[] = [
    {
      id: "plan-nav",
      name: "Navigation produces open_page",
      goal: "go to http://localhost:3210",
      expectedTaskTypes: ["open_page"],
      timeout: 5000
    },
    {
      id: "plan-screenshot",
      name: "Screenshot produces open_page + screenshot",
      goal: "take screenshot of http://localhost:3210",
      expectedTaskTypes: ["open_page", "screenshot"],
      timeout: 5000
    },
    {
      id: "plan-search",
      name: "Search produces open_page + type + click",
      goal: 'search for "test" on http://localhost:3210',
      expectedTaskTypes: ["open_page", "type", "click"],
      timeout: 5000
    },
    {
      id: "plan-login",
      name: "Login produces open_page + type + type + click",
      goal: "login to http://localhost:3210 with admin/secret",
      expectedTaskTypes: ["open_page", "type", "type", "click"],
      timeout: 5000
    },
    {
      id: "plan-browse-click",
      name: "Browse and click produces open_page + click",
      goal: 'go to http://localhost:3210 and click "#btn"',
      expectedTaskTypes: ["open_page", "click"],
      timeout: 5000
    },
    {
      id: "plan-extract",
      name: "Extract text produces open_page + visual_extract",
      goal: "get text from http://localhost:3210",
      expectedTaskTypes: ["open_page", "visual_extract"],
      timeout: 5000
    },
    {
      id: "plan-fill",
      name: "Fill form produces open_page + type",
      goal: 'fill "#name" with "John" on http://localhost:3210/form',
      expectedTaskTypes: ["open_page", "type"],
      timeout: 5000
    }
  ];

  for (const scenario of browserPlanScenarios) {
    test(`[${scenario.id}] ${scenario.name}`, { timeout: scenario.timeout }, () => {
      const plan = matchTemplatePlan(scenario.goal);

      assert.ok(
        plan !== null,
        `Template planner should produce a plan for goal: "${scenario.goal}"`
      );

      const actualTypes = plan!.map((t) => t.type);
      assert.deepStrictEqual(
        actualTypes,
        scenario.expectedTaskTypes,
        `Task types mismatch for "${scenario.goal}". Got [${actualTypes.join(", ")}], expected [${scenario.expectedTaskTypes.join(", ")}]`
      );
    });
  }
});

describe("E2E Scenarios — payload validation", () => {
  test("API health check has correct URL in payload", () => {
    const plan = matchTemplatePlan("check health of http://localhost:3210/api/health");
    assert.ok(plan);
    assert.equal(plan[0].type, "http_request");
    assert.equal(plan[0].payload.url, "http://localhost:3210/api/health");
    assert.equal(plan[0].payload.method, "GET");
  });

  test("File read has correct path in payload", () => {
    const plan = matchTemplatePlan("read file /tmp/test-data.txt");
    assert.ok(plan);
    assert.equal(plan[0].type, "read_file");
    assert.equal(plan[0].payload.path, "/tmp/test-data.txt");
  });

  test("Shell command has correct code in payload", () => {
    const plan = matchTemplatePlan('run command "echo hello world"');
    assert.ok(plan);
    assert.equal(plan[0].type, "run_code");
    assert.equal(plan[0].payload.code, "echo hello world");
    assert.equal(plan[0].payload.language, "shell");
  });

  test("Login has username and password in type payloads", () => {
    const plan = matchTemplatePlan("login to http://localhost:3210 with admin/secret123");
    assert.ok(plan);
    assert.equal(plan.length, 4);
    // First type is username
    assert.equal(plan[1].type, "type");
    assert.equal(plan[1].payload.text, "admin");
    // Second type is password
    assert.equal(plan[2].type, "type");
    assert.equal(plan[2].payload.text, "secret123");
  });

  test("Search has search term in type payload", () => {
    const plan = matchTemplatePlan('search for "typescript" on http://localhost:3210');
    assert.ok(plan);
    assert.equal(plan[1].type, "type");
    assert.equal(plan[1].payload.text, "typescript");
  });
});
