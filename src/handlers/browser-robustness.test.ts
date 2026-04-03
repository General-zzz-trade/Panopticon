import test from "node:test";
import assert from "node:assert/strict";
import { shouldRequestHelp } from "../cognition/meta-cognition";
import type { MetaCognitionAssessment } from "../cognition/meta-cognition";

test("shouldRequestHelp returns true when stuck and low confidence", () => {
  const assessment: MetaCognitionAssessment = {
    domainFamiliarity: 0.1,
    selectorRiskLevel: 0.8,
    stuckLevel: 0.8,
    confidenceMultiplier: 0.5,
    rationale: "unfamiliar domain, high-risk selector, appears stuck"
  };
  assert.equal(shouldRequestHelp(assessment), true);
});

test("shouldRequestHelp returns false when progressing normally", () => {
  const assessment: MetaCognitionAssessment = {
    domainFamiliarity: 0.8,
    selectorRiskLevel: 0.1,
    stuckLevel: 0.2,
    confidenceMultiplier: 0.9,
    rationale: "normal experience level"
  };
  assert.equal(shouldRequestHelp(assessment), false);
});

test("shouldRequestHelp returns false when stuck but confidence is ok", () => {
  const assessment: MetaCognitionAssessment = {
    domainFamiliarity: 0.5,
    selectorRiskLevel: 0.3,
    stuckLevel: 0.8,
    confidenceMultiplier: 0.7,
    rationale: "appears stuck"
  };
  assert.equal(shouldRequestHelp(assessment), false);
});
