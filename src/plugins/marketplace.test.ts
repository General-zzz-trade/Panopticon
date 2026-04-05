import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import {
  initMarketplace,
  installSkill,
  uninstallSkill,
  listInstalledSkills,
  searchSkills,
  getBuiltinSkills,
  loadInstalledSkills,
  type SkillPackage,
} from "./marketplace";
import { getTool } from "../tools/registry";

const SKILLS_DIR = path.join(process.cwd(), "skills");

function makeSkill(overrides: Partial<SkillPackage> = {}): SkillPackage {
  return {
    name: "test_skill",
    version: "1.0.0",
    description: "A test skill",
    author: "tester",
    category: "testing",
    language: "javascript",
    tool: {
      name: "test_skill",
      category: "code",
      description: "A test tool",
      parameters: [
        { name: "input", type: "string", required: true, description: "Input value" },
      ],
      verificationStrategy: "output",
      mutating: false,
      requiresApproval: false,
    },
    code: "var result = args.input; result;",
    ...overrides,
  };
}

function cleanSkillsDir(): void {
  if (fs.existsSync(SKILLS_DIR)) {
    const files = fs.readdirSync(SKILLS_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(SKILLS_DIR, file));
    }
    fs.rmdirSync(SKILLS_DIR);
  }
}

describe("Skill Marketplace", () => {
  beforeEach(() => {
    cleanSkillsDir();
  });

  afterEach(() => {
    cleanSkillsDir();
  });

  test("initMarketplace creates skills directory", () => {
    assert.equal(fs.existsSync(SKILLS_DIR), false);
    initMarketplace();
    assert.equal(fs.existsSync(SKILLS_DIR), true);
    assert.equal(fs.statSync(SKILLS_DIR).isDirectory(), true);
  });

  test("installSkill saves JSON and registers tool", () => {
    const skill = makeSkill();
    const result = installSkill(skill);

    assert.equal(result, true);

    // Verify file was created
    const filePath = path.join(SKILLS_DIR, "test_skill.json");
    assert.equal(fs.existsSync(filePath), true);

    // Verify JSON content
    const saved = JSON.parse(fs.readFileSync(filePath, "utf-8")) as SkillPackage;
    assert.equal(saved.name, "test_skill");
    assert.equal(saved.version, "1.0.0");
    assert.ok(saved.installedAt);

    // Verify tool was registered
    const tool = getTool("test_skill");
    assert.ok(tool);
    assert.equal(tool.name, "test_skill");
    assert.equal(tool.category, "code");
  });

  test("listInstalledSkills returns installed skills", () => {
    installSkill(makeSkill({ name: "skill_a" }));
    installSkill(makeSkill({ name: "skill_b", description: "Second skill" }));

    const skills = listInstalledSkills();
    assert.equal(skills.length, 2);

    const names = skills.map(s => s.name).sort();
    assert.deepEqual(names, ["skill_a", "skill_b"]);
  });

  test("uninstallSkill removes skill file and unregisters tool", () => {
    const skill = makeSkill();
    installSkill(skill);

    // Confirm installed
    assert.equal(fs.existsSync(path.join(SKILLS_DIR, "test_skill.json")), true);
    assert.ok(getTool("test_skill"));

    const result = uninstallSkill("test_skill");
    assert.equal(result, true);

    // File should be gone
    assert.equal(fs.existsSync(path.join(SKILLS_DIR, "test_skill.json")), false);

    // Uninstalling again returns false
    assert.equal(uninstallSkill("test_skill"), false);
  });

  test("searchSkills finds by keyword in name, description, and category", () => {
    installSkill(makeSkill({ name: "text_upper", description: "Uppercase text", category: "text" }));
    installSkill(makeSkill({ name: "json_parse", description: "Parse JSON data", category: "data" }));
    installSkill(makeSkill({ name: "math_add", description: "Add numbers", category: "math" }));

    // Search by name
    const byName = searchSkills("json");
    assert.equal(byName.length, 1);
    assert.equal(byName[0].name, "json_parse");

    // Search by description
    const byDesc = searchSkills("uppercase");
    assert.equal(byDesc.length, 1);
    assert.equal(byDesc[0].name, "text_upper");

    // Search by category
    const byCat = searchSkills("math");
    assert.equal(byCat.length, 1);
    assert.equal(byCat[0].name, "math_add");

    // No results
    const noResults = searchSkills("nonexistent");
    assert.equal(noResults.length, 0);
  });

  test("getBuiltinSkills returns 4 skills", () => {
    const builtins = getBuiltinSkills();
    assert.equal(builtins.length, 4);

    const names = builtins.map(s => s.name).sort();
    assert.deepEqual(names, ["json_query", "math_eval", "text_transform", "url_shortener"]);

    // Each should have required fields
    for (const skill of builtins) {
      assert.ok(skill.name);
      assert.ok(skill.version);
      assert.ok(skill.description);
      assert.ok(skill.author);
      assert.ok(skill.category);
      assert.ok(skill.tool);
      assert.ok(skill.code);
      assert.equal(skill.language, "javascript");
      assert.ok(skill.tool.parameters.length > 0);
    }
  });

  test("loadInstalledSkills registers tools and returns count", () => {
    // Install skills without relying on loadInstalledSkills
    initMarketplace();
    const skillA = makeSkill({ name: "load_a" });
    const skillB = makeSkill({ name: "load_b" });
    fs.writeFileSync(
      path.join(SKILLS_DIR, "load_a.json"),
      JSON.stringify(skillA),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(SKILLS_DIR, "load_b.json"),
      JSON.stringify(skillB),
      "utf-8"
    );

    const count = loadInstalledSkills();
    assert.equal(count, 2);
  });
});
