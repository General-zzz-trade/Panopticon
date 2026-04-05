import test from "node:test";
import assert from "node:assert/strict";
import {
  registerSkill,
  findSkillsForGoal,
  composeSkills,
  getAllSkills,
  resetSkillLibrary,
  type Skill,
} from "./skill-composer";

test("skill-composer", async (t) => {
  t.beforeEach(() => {
    resetSkillLibrary();
  });

  await t.test("registerSkill and findSkillsForGoal", () => {
    const builtins = getAllSkills();
    // Should have 4 built-in skills
    assert.ok(builtins.length >= 4);
    assert.ok(builtins.some((s) => s.name === "login"));
    assert.ok(builtins.some((s) => s.name === "search"));
    assert.ok(builtins.some((s) => s.name === "navigate"));
    assert.ok(builtins.some((s) => s.name === "fill_form"));

    // Find by keyword
    const loginSkills = findSkillsForGoal("log in to the website");
    assert.ok(loginSkills.some((s) => s.name === "login"));

    const searchSkills = findSkillsForGoal("search for products");
    assert.ok(searchSkills.some((s) => s.name === "search"));

    // Register a custom skill
    registerSkill({
      name: "checkout",
      description: "Complete a purchase checkout",
      steps: ["click", "type", "click"],
      preconditions: ["logged_in", "cart_has_items"],
      postconditions: ["order_placed"],
      successRate: 0.75,
      domain: "ecommerce",
    });

    const checkoutSkills = findSkillsForGoal("checkout purchase");
    assert.ok(checkoutSkills.some((s) => s.name === "checkout"));
  });

  await t.test("composeSkills chains skills by pre/postconditions", () => {
    const skills = getAllSkills();

    // Compose: from nothing to logged_in
    // Should chain: navigate ([] -> page_loaded) + login (page_loaded -> logged_in)
    const plan = composeSkills("", "logged_in", skills);
    assert.ok(plan !== undefined);
    assert.ok(plan.skills.length >= 2);
    assert.equal(plan.skills[0].name, "navigate");
    assert.equal(plan.skills[1].name, "login");
    assert.ok(plan.totalSteps > 0);
    assert.ok(plan.estimatedSuccessRate > 0 && plan.estimatedSuccessRate <= 1);
    assert.ok(plan.rationale.includes("navigate"));
    assert.ok(plan.rationale.includes("login"));
  });

  await t.test("composeSkills with single skill", () => {
    const skills = getAllSkills();

    // From page_loaded to logged_in: just login
    const plan = composeSkills("page_loaded", "logged_in", skills);
    assert.ok(plan !== undefined);
    assert.equal(plan.skills.length, 1);
    assert.equal(plan.skills[0].name, "login");
  });

  await t.test("composeSkills returns undefined when no valid composition exists", () => {
    const skills = getAllSkills();

    // No skill produces "database_migrated"
    const plan = composeSkills("", "database_migrated", skills);
    assert.equal(plan, undefined);
  });

  await t.test("composeSkills returns undefined when target already satisfied", () => {
    const skills = getAllSkills();

    // Already have the target condition
    const plan = composeSkills("logged_in", "logged_in", skills);
    assert.equal(plan, undefined);
  });

  await t.test("registerSkill replaces existing skill with same name", () => {
    const before = getAllSkills().find((s) => s.name === "login");
    assert.ok(before !== undefined);
    assert.equal(before.successRate, 0.85);

    registerSkill({
      name: "login",
      description: "Updated login",
      steps: ["open_page", "type", "click"],
      preconditions: ["page_loaded"],
      postconditions: ["logged_in"],
      successRate: 0.95,
    });

    const after = getAllSkills().find((s) => s.name === "login");
    assert.ok(after !== undefined);
    assert.equal(after.successRate, 0.95);
    // Total count should not increase
    assert.equal(
      getAllSkills().filter((s) => s.name === "login").length,
      1
    );
  });
});
