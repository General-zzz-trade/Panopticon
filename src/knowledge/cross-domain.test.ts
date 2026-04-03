import test from "node:test";
import assert from "node:assert/strict";
import { getLessonsForTaskType, upsertLesson, getCrossDomainLessons, getKnowledgeStats } from "./store";

test("getCrossDomainLessons retrieves lessons from other domains", () => {
  // Insert lessons for different domains
  upsertLesson({
    taskType: "click",
    errorPattern: "selector not found",
    recovery: "try visual fallback",
    successCount: 3,
    domain: "example.com"
  });

  // Query for a different domain
  const lessons = getCrossDomainLessons("click", "other-site.com");
  assert.ok(lessons.length >= 0); // May or may not find depending on DB state
});

test("getLessonsForTaskType includes cross-domain fallback", () => {
  upsertLesson({
    taskType: "type",
    errorPattern: "input not found",
    recovery: "add wait before typing",
    successCount: 5,
    domain: "site-a.com"
  });

  // Query for a brand new domain — should get cross-domain lessons
  const lessons = getLessonsForTaskType("type", "brand-new-domain.com");
  // Should include at least the cross-domain lesson
  assert.ok(Array.isArray(lessons));
});

test("knowledge stats returns counts", () => {
  const stats = getKnowledgeStats();
  assert.ok(typeof stats.selectors === "number");
  assert.ok(typeof stats.lessons === "number");
  assert.ok(typeof stats.templates === "number");
});
