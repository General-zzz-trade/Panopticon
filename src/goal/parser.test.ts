import test from "node:test";
import assert from "node:assert/strict";
import { parseGoalSync } from "./parser";

test("parseGoalSync extracts text_present from assert text", () => {
  const goal = parseGoalSync('open page "https://example.com" and assert text "Hello World"');
  const textCriteria = goal.successCriteria.filter(c => c.type === "text_present");
  assert.equal(textCriteria.length, 1);
  assert.equal(textCriteria[0].value, "Hello World");
  assert.equal(textCriteria[0].confidence, 1.0);
  assert.equal(textCriteria[0].source, "dsl");
});

test("parseGoalSync extracts url_reached from open page", () => {
  const goal = parseGoalSync('open page "https://example.com"');
  const urlCriteria = goal.successCriteria.filter(c => c.type === "url_reached");
  assert.equal(urlCriteria.length, 1);
  assert.equal(urlCriteria[0].value, "https://example.com");
});

test("parseGoalSync extracts multiple criteria", () => {
  const goal = parseGoalSync('open page "https://app.com/login" and click "#submit" and assert text "Dashboard"');
  assert.equal(goal.successCriteria.length, 3); // text + url + element
  const types = goal.successCriteria.map(c => c.type).sort();
  assert.deepEqual(types, ["element_exists", "text_present", "url_reached"]);
});

test("parseGoalSync returns open-ended for NL goal without criteria", () => {
  const goal = parseGoalSync("make the website more accessible");
  assert.equal(goal.successCriteria.length, 0);
  assert.equal(goal.difficulty, "open-ended");
});

test("parseGoalSync estimates difficulty correctly", () => {
  assert.equal(parseGoalSync('open page "http://x.com"').difficulty, "trivial");
  assert.equal(parseGoalSync('open page "http://x.com" and click "#a" and assert text "B"').difficulty, "simple");
  assert.equal(parseGoalSync('open page "http://x.com" and click "#login" and type "#user" "admin" and type "#pass" "123" and click "#submit" and assert text "Dashboard"').difficulty, "medium");
});

test("parseGoalSync extracts time constraints", () => {
  const goal = parseGoalSync('open page "http://x.com" within 30 seconds');
  const timeConstraint = goal.constraints.find(c => c.type === "max_duration_ms");
  assert.ok(timeConstraint);
  assert.equal(timeConstraint!.value, 30000);
});

test("parseGoalSync extracts safe_only constraint", () => {
  const goal = parseGoalSync('check the website safely');
  const safeConstraint = goal.constraints.find(c => c.type === "safe_only");
  assert.ok(safeConstraint);
});
