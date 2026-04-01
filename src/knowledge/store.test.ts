import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeDb, getDb } from "../db/client";
import {
  initKnowledgeTable,
  upsertSelector,
  getSelectorsForDomain,
  upsertLesson,
  getLessonsForTaskType,
  upsertTemplate,
  findTemplates,
  retrieveRelevantKnowledge,
  getKnowledgeStats
} from "./store";

beforeEach(() => {
  initKnowledgeTable();
  getDb().prepare("DELETE FROM knowledge").run();
});

test("upsertSelector: insert and retrieve", () => {
  upsertSelector({ domain: "localhost:3000", description: "login button", selector: "#login-btn", successCount: 1, failureCount: 0 });
  const results = getSelectorsForDomain("localhost:3000");
  assert.equal(results.length, 1);
  assert.equal(results[0].selector, "#login-btn");
  assert.equal(results[0].description, "login button");
});

test("upsertSelector: accumulates success and failure counts", () => {
  upsertSelector({ domain: "localhost:3000", description: "submit", selector: ".submit-btn", successCount: 3, failureCount: 1 });
  upsertSelector({ domain: "localhost:3000", description: "submit", selector: ".submit-btn", successCount: 1, failureCount: 0 });
  const results = getSelectorsForDomain("localhost:3000");
  assert.equal(results.length, 1);
  const entry = results[0];
  assert.equal(entry.successCount, 4);
  assert.equal(entry.failureCount, 1);
});

test("getSelectorsForDomain: returns empty for unknown domain", () => {
  const results = getSelectorsForDomain("unknown.example.com");
  assert.deepEqual(results, []);
});

test("upsertLesson: insert and retrieve by task type", () => {
  upsertLesson({ taskType: "click", errorPattern: "element not found", recovery: "use visual_click", successCount: 1 });
  const lessons = getLessonsForTaskType("click");
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].recovery, "use visual_click");
});

test("upsertLesson: confidence increases on update", () => {
  upsertLesson({ taskType: "type", errorPattern: "timeout", recovery: "add wait 1000ms", successCount: 0 });
  upsertLesson({ taskType: "type", errorPattern: "timeout", recovery: "add wait 1000ms", successCount: 1 });
  const lessons = getLessonsForTaskType("type");
  assert.equal(lessons.length, 1);
  const row = getDb().prepare("SELECT confidence FROM knowledge WHERE type='failure_lesson'").get() as { confidence: number };
  assert.ok(row.confidence > 0.5);
});

test("getLessonsForTaskType: scoped to domain", () => {
  upsertLesson({ taskType: "click", errorPattern: "not visible", recovery: "scroll first", domain: "app.example.com", successCount: 1 });
  upsertLesson({ taskType: "click", errorPattern: "not visible", recovery: "wait 500ms", domain: "other.com", successCount: 1 });
  const lessons = getLessonsForTaskType("click", "app.example.com");
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].recovery, "scroll first");
});

test("upsertTemplate: insert and find by keyword", () => {
  upsertTemplate({
    goalPattern: "login to dashboard",
    tasksSummary: "open_page -> click -> type -> click -> assert_text",
    tasksJson: "[]",
    successCount: 1
  });
  const found = findTemplates(["login", "dashboard"]);
  assert.equal(found.length, 1);
  assert.ok(found[0].tasksSummary.includes("assert_text"));
});

test("findTemplates: no match for unrelated keywords", () => {
  upsertTemplate({ goalPattern: "submit contact form", tasksSummary: "open_page -> type -> click", tasksJson: "[]", successCount: 1 });
  const found = findTemplates(["login", "dashboard"]);
  assert.equal(found.length, 0);
});

test("retrieveRelevantKnowledge: returns combined knowledge", () => {
  upsertSelector({ domain: "myapp.local", description: "header nav", selector: "nav.header", successCount: 2, failureCount: 0 });
  upsertLesson({ taskType: "assert_text", errorPattern: "text not found", recovery: "add wait 1500ms", successCount: 1 });
  const knowledge = retrieveRelevantKnowledge("open homepage and assert_text", "myapp.local");
  assert.ok(knowledge.selectors.length >= 1);
  assert.ok(knowledge.lessons.length >= 1);
});

test("getKnowledgeStats: counts by type", () => {
  upsertSelector({ domain: "test.com", description: "btn", selector: "#btn", successCount: 1, failureCount: 0 });
  upsertLesson({ taskType: "click", errorPattern: "err", recovery: "retry", successCount: 0 });
  upsertTemplate({ goalPattern: "do something", tasksSummary: "click", tasksJson: "[]", successCount: 1 });
  const stats = getKnowledgeStats();
  assert.equal(stats.selectors, 1);
  assert.equal(stats.lessons, 1);
  assert.equal(stats.templates, 1);
});
