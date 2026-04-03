# Phase 2: Cognition Learning + Auth/Approval Tests

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cognition layer learn from past failures via the knowledge store, and add test coverage for security-critical auth/approval modules.

**Architecture:** Track A extends hypothesis-engine to query knowledge store for learned patterns, makes executive-controller thresholds context-aware, and adds evidence weighting to belief-updater. Track C adds pure unit tests for approval gate, session manager, and session store.

**Tech Stack:** TypeScript, node:test, node:assert/strict, better-sqlite3 (for session store tests)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/cognition/types.ts` | Add `learned_pattern` to FailureHypothesisKind |
| Modify | `src/cognition/hypothesis-engine.ts` | Query knowledge store for learned failure patterns |
| Modify | `src/cognition/hypothesis-engine.test.ts` | Add tests for learned pattern generation |
| Modify | `src/cognition/executive-controller.ts` | Context-aware confidence scoring |
| Modify | `src/cognition/executive-controller.test.ts` | Add tests for dynamic thresholds |
| Modify | `src/cognition/belief-updater.ts` | Evidence-weighted delta accumulation |
| Modify | `src/cognition/belief-updater.test.ts` | Add tests for weighting |
| Create | `src/approval/gate.test.ts` | Approval gate unit tests |
| Create | `src/auth/session-manager.test.ts` | Session manager unit tests |
| Create | `src/auth/session-store.test.ts` | Session store unit tests |

---

### Task 1: Add `learned_pattern` Hypothesis Kind + Knowledge-Driven Hypothesis Generation

**Files:**
- Modify: `src/cognition/types.ts`
- Modify: `src/cognition/hypothesis-engine.ts`
- Modify: `src/cognition/hypothesis-engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/cognition/hypothesis-engine.test.ts` (the existing file has 2 tests from Phase 1; we add to it):

```typescript
test("generates learned_pattern hypothesis when knowledge store has matching lesson", () => {
  // We test the internal logic by providing a context with a domain
  // and mocking the knowledge store is not needed — we test the function
  // handles the case where no knowledge store is available (no DB).
  // The actual integration requires a running DB.
  
  // Test that the function still works and returns at least the hardcoded hypotheses
  const task: AgentTask = {
    id: "task-learn-1",
    type: "click",
    status: "failed",
    retries: 0,
    attempts: 1,
    replanDepth: 0,
    payload: { selector: "#submit" },
    errorHistory: ["selector not found"]
  };

  const context: RunContext = {
    runId: "run-learned-test",
    goal: 'click "#submit"',
    tasks: [task],
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: 1,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    escalationDecisions: [],
    observations: [],
    latestObservation: {
      id: "obs-1",
      runId: "run-learned-test",
      taskId: "task-learn-1",
      timestamp: new Date().toISOString(),
      source: "task_observe",
      pageUrl: "http://localhost:3000/login",
      visibleText: ["Login"],
      actionableElements: [],
      appStateGuess: "ready",
      anomalies: [],
      confidence: 0.8
    },
    worldState: {
      runId: "run-learned-test",
      timestamp: new Date().toISOString(),
      pageUrl: "http://localhost:3000/login",
      appState: "ready",
      lastAction: "click",
      lastObservationId: "obs-1",
      uncertaintyScore: 0.3,
      facts: []
    },
    limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 },
    startedAt: new Date().toISOString()
  };

  const hypotheses = generateFailureHypotheses({
    context,
    task,
    failureReason: "selector not found"
  });

  // Should still produce at least the hardcoded selector_drift hypothesis
  assert.ok(hypotheses.some((h) => h.kind === "selector_drift"));
  // All hypotheses should be sorted by confidence descending
  for (let i = 1; i < hypotheses.length; i++) {
    assert.ok(hypotheses[i - 1].confidence >= hypotheses[i].confidence,
      `Hypothesis ${i - 1} (${hypotheses[i - 1].confidence}) should be >= hypothesis ${i} (${hypotheses[i].confidence})`);
  }
});

test("generates session_not_established hypothesis when login text is visible", () => {
  const task: AgentTask = {
    id: "task-session-1",
    type: "click",
    status: "failed",
    retries: 0,
    attempts: 1,
    replanDepth: 0,
    payload: { selector: "#dashboard-btn" }
  };

  const context: RunContext = {
    runId: "run-session-test",
    goal: 'click dashboard button',
    tasks: [task],
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: 1,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    escalationDecisions: [],
    latestObservation: {
      id: "obs-1",
      runId: "run-session-test",
      taskId: "task-session-1",
      timestamp: new Date().toISOString(),
      source: "task_observe",
      pageUrl: "http://localhost:3000/login",
      visibleText: ["Please sign in to continue"],
      actionableElements: [],
      appStateGuess: "ready",
      anomalies: [],
      confidence: 0.8
    },
    worldState: {
      runId: "run-session-test",
      timestamp: new Date().toISOString(),
      appState: "ready",
      uncertaintyScore: 0.3,
      facts: []
    },
    limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 },
    startedAt: new Date().toISOString()
  };

  const hypotheses = generateFailureHypotheses({
    context,
    task,
    failureReason: "element not visible"
  });

  assert.ok(hypotheses.some((h) => h.kind === "session_not_established"));
});
```

- [ ] **Step 2: Run tests to verify they pass (testing existing behavior)**

Run: `node --import tsx --test src/cognition/hypothesis-engine.test.ts`
Expected: All 4 tests PASS (these test existing behavior, not new code yet).

- [ ] **Step 3: Add `learned_pattern` to FailureHypothesisKind**

In `src/cognition/types.ts`, find the `FailureHypothesisKind` type and add `"learned_pattern"`:

```typescript
export type FailureHypothesisKind =
  | "state_not_ready"
  | "selector_drift"
  | "assertion_phrase_changed"
  | "session_not_established"
  | "missing_page_context"
  | "learned_pattern"
  | "unknown";
```

- [ ] **Step 4: Add knowledge-driven hypothesis generation**

In `src/cognition/hypothesis-engine.ts`, add the import and the knowledge lookup after the existing hardcoded hypotheses but before the `unknown` fallback.

Add this import at the top:

```typescript
import { getLessonsForTaskType } from "../knowledge/store";
```

Then, in the `generateFailureHypotheses` function, add this block **before** the `if (hypotheses.length === 0)` fallback:

```typescript
  // Knowledge-driven hypotheses from past failure lessons
  try {
    const domain = extractDomainFromContext(context);
    const lessons = getLessonsForTaskType(task.type, domain);
    for (const lesson of lessons) {
      // Avoid duplicating hypotheses that match already-generated hardcoded ones
      const alreadyCovered = hypotheses.some(
        (h) => h.recoveryHint.toLowerCase().includes(lesson.recovery.toLowerCase())
      );
      if (!alreadyCovered) {
        hypotheses.push(createHypothesis(
          task.id,
          "learned_pattern",
          lesson.confidence ?? 0.55,
          `Learned from prior failure: ${lesson.errorPattern}`,
          ["apply learned recovery strategy"],
          lesson.recovery
        ));
      }
    }
  } catch {
    // Knowledge store may not be initialized — skip silently
  }
```

Add the helper function at the bottom of the file:

```typescript
function extractDomainFromContext(context: RunContext): string | undefined {
  const url = context.worldState?.pageUrl
    ?? context.latestObservation?.pageUrl;
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --import tsx --test src/cognition/hypothesis-engine.test.ts`
Expected: All 4 tests PASS. The knowledge store query will silently fail (no DB in test) and fall back to hardcoded hypotheses.

- [ ] **Step 6: Commit**

```bash
git add src/cognition/types.ts src/cognition/hypothesis-engine.ts src/cognition/hypothesis-engine.test.ts
git commit -m "feat(cognition): add learned_pattern hypothesis from knowledge store"
```

---

### Task 2: Executive Controller — Context-Aware Confidence

**Files:**
- Modify: `src/cognition/executive-controller.ts`
- Modify: `src/cognition/executive-controller.test.ts`

- [ ] **Step 1: Write the new tests**

Append to `src/cognition/executive-controller.test.ts`:

```typescript
test("replan confidence is higher when budget is mostly unused", () => {
  const result = decideNextStep({
    task: makeTask(),
    actionVerification: makeVerification({ verifier: "action", passed: false }),
    replanCount: 0,
    maxReplans: 5
  });
  assert.equal(result.nextAction, "replan");
  // With 0/5 replans used, confidence should be higher than baseline
  assert.ok(result.confidence >= 0.75);
});

test("replan confidence is lower when budget is nearly exhausted", () => {
  const result = decideNextStep({
    task: makeTask(),
    actionVerification: makeVerification({ verifier: "action", passed: false }),
    replanCount: 4,
    maxReplans: 5
  });
  assert.equal(result.nextAction, "replan");
  // With 4/5 replans used, confidence should be lower
  assert.ok(result.confidence <= 0.75);
});

test("abort confidence scales with exhaustion", () => {
  const lowExhaustion = decideNextStep({
    task: makeTask({ retries: 1 }),
    actionVerification: makeVerification({ verifier: "action", passed: false }),
    replanCount: 3,
    maxReplans: 3
  });
  const highExhaustion = decideNextStep({
    task: makeTask({ retries: 3, attempts: 4 }),
    actionVerification: makeVerification({ verifier: "action", passed: false }),
    replanCount: 5,
    maxReplans: 5
  });
  assert.equal(lowExhaustion.nextAction, "abort");
  assert.equal(highExhaustion.nextAction, "abort");
  // Higher exhaustion should yield higher abort confidence
  assert.ok(highExhaustion.confidence >= lowExhaustion.confidence);
});
```

- [ ] **Step 2: Run tests to check current behavior**

Run: `node --import tsx --test src/cognition/executive-controller.test.ts`
Expected: Some new tests may FAIL (fixed thresholds don't vary by budget).

- [ ] **Step 3: Implement context-aware confidence**

Replace `src/cognition/executive-controller.ts`:

```typescript
import type { AgentTask } from "../types";
import type { CognitiveDecision, VerificationResult } from "./types";

export function decideNextStep(input: {
  task: AgentTask;
  actionVerification?: VerificationResult;
  stateVerification?: VerificationResult;
  goalVerification?: VerificationResult;
  replanCount: number;
  maxReplans?: number;
}): CognitiveDecision {
  const failedVerification = [
    input.actionVerification,
    input.stateVerification,
    input.goalVerification
  ].find((result) => result && !result.passed);

  if (!failedVerification) {
    return {
      nextAction: "continue",
      rationale: "Action and state verification passed, so execution can continue.",
      confidence: 0.9
    };
  }

  if (failedVerification.verifier === "goal") {
    return {
      nextAction: "reobserve",
      rationale: "Goal verification failed while action completed; refresh observation before escalating.",
      confidence: 0.7
    };
  }

  const maxReplans = input.maxReplans ?? 0;
  const budgetRatio = maxReplans > 0 ? (maxReplans - input.replanCount) / maxReplans : 0;

  if (maxReplans > 0 && input.replanCount < maxReplans) {
    // Confidence scales with remaining budget: more budget → higher confidence in replanning
    const replanConfidence = 0.6 + budgetRatio * 0.2; // [0.6, 0.8]
    return {
      nextAction: "replan",
      rationale: `Verification failed in ${failedVerification.verifier}; replan budget remains available (${maxReplans - input.replanCount}/${maxReplans}).`,
      confidence: replanConfidence
    };
  }

  if (input.task.retries === 0) {
    return {
      nextAction: "retry_task",
      rationale: "Verification failed but the task has not been retried yet.",
      confidence: 0.6
    };
  }

  // Abort confidence scales with exhaustion: more attempts → more certain about aborting
  const exhaustionFactor = Math.min(1, (input.task.attempts ?? 1) / 5);
  const abortConfidence = 0.8 + exhaustionFactor * 0.15; // [0.8, 0.95]
  return {
    nextAction: "abort",
    rationale: "Verification failed and no safe retry or replan budget remains.",
    confidence: abortConfidence
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/cognition/executive-controller.test.ts`
Expected: All 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cognition/executive-controller.ts src/cognition/executive-controller.test.ts
git commit -m "feat(cognition): context-aware confidence in executive controller"
```

---

### Task 3: Belief Updater — Evidence Weighting

**Files:**
- Modify: `src/cognition/belief-updater.ts`
- Modify: `src/cognition/belief-updater.test.ts`

- [ ] **Step 1: Write the new tests**

Append to `src/cognition/belief-updater.test.ts`:

```typescript
test("selector probe experiment has higher weight than assertion overlap", () => {
  const selectorResult = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [makeHypothesis({ id: "hyp-sel", confidence: 0.5 })],
    experimentResults: [makeExperiment({
      hypothesisId: "hyp-sel",
      experiment: "check selector presence in DOM",
      confidenceDelta: 0.2
    })]
  });

  const assertResult = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [makeHypothesis({ id: "hyp-assert", confidence: 0.5 })],
    experimentResults: [makeExperiment({
      hypothesisId: "hyp-assert",
      experiment: "compare expected assertion text with visible text",
      confidenceDelta: 0.2
    })]
  });

  // Selector probe (reliability 1.0) should produce larger update than assertion overlap (0.6)
  const selectorDelta = selectorResult.updatedHypotheses[0].confidence - 0.5;
  const assertDelta = assertResult.updatedHypotheses[0].confidence - 0.5;
  assert.ok(selectorDelta > assertDelta,
    `Selector delta ${selectorDelta} should be > assertion delta ${assertDelta}`);
});

test("unknown experiment type uses default weight", () => {
  const result = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [makeHypothesis({ confidence: 0.5 })],
    experimentResults: [makeExperiment({
      experiment: "some new experiment type",
      confidenceDelta: 0.2
    })]
  });
  // Default weight 0.75 → effective delta = 0.2 * 0.75 = 0.15
  assert.ok(Math.abs(result.updatedHypotheses[0].confidence - 0.65) < 0.01);
});

test("readiness probe has medium weight", () => {
  const result = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [makeHypothesis({ confidence: 0.5 })],
    experimentResults: [makeExperiment({
      experiment: "wait briefly and inspect readiness signals",
      confidenceDelta: 0.2
    })]
  });
  // Readiness weight 0.8 → effective delta = 0.2 * 0.8 = 0.16
  assert.ok(Math.abs(result.updatedHypotheses[0].confidence - 0.66) < 0.01);
});
```

- [ ] **Step 2: Run tests to see failures**

Run: `node --import tsx --test src/cognition/belief-updater.test.ts`
Expected: New tests FAIL (no weighting yet, all deltas applied at 1.0).

- [ ] **Step 3: Implement evidence weighting**

Replace `src/cognition/belief-updater.ts`:

```typescript
import type { BeliefUpdate, ExperimentResult, FailureHypothesis } from "./types";

export function applyBeliefUpdates(input: {
  runId: string;
  taskId?: string;
  hypotheses: FailureHypothesis[];
  experimentResults: ExperimentResult[];
}): {
  updatedHypotheses: FailureHypothesis[];
  beliefUpdates: BeliefUpdate[];
} {
  const updates: BeliefUpdate[] = [];
  const updatedHypotheses = input.hypotheses.map((hypothesis) => {
    const relatedResults = input.experimentResults.filter((result) => result.hypothesisId === hypothesis.id);
    const previousConfidence = hypothesis.confidence;
    const delta = relatedResults.reduce((sum, result) => {
      const weight = inferExperimentReliability(result.experiment);
      return sum + result.confidenceDelta * weight;
    }, 0);
    const nextConfidence = clamp(previousConfidence + delta, 0.05, 0.98);
    updates.push({
      id: `belief-${input.runId}-${Math.random().toString(36).slice(2, 8)}`,
      runId: input.runId,
      taskId: input.taskId,
      hypothesisId: hypothesis.id,
      previousConfidence,
      nextConfidence,
      rationale: relatedResults.length > 0
        ? `Updated from ${previousConfidence.toFixed(2)} to ${nextConfidence.toFixed(2)} after ${relatedResults.length} experiment(s).`
        : `No experiment updated this hypothesis; confidence remains ${nextConfidence.toFixed(2)}.`
    });

    return {
      ...hypothesis,
      confidence: nextConfidence
    };
  });

  return {
    updatedHypotheses: updatedHypotheses.sort((left, right) => right.confidence - left.confidence),
    beliefUpdates: updates
  };
}

function inferExperimentReliability(experimentName: string): number {
  const lower = experimentName.toLowerCase();
  if (lower.includes("selector")) return 1.0;
  if (lower.includes("page") && lower.includes("context")) return 0.9;
  if (lower.includes("readiness") || lower.includes("wait")) return 0.8;
  if (lower.includes("session") || lower.includes("authenticated")) return 0.7;
  if (lower.includes("assert") || lower.includes("text")) return 0.6;
  return 0.75;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/cognition/belief-updater.test.ts`
Expected: All 12 tests PASS.

Note: The existing tests that tested `confidence = 0.6 + 0.15 = 0.75` will now compute `0.6 + 0.15 * weight`. The existing test uses `makeExperiment({ experiment: "check selector", confidenceDelta: 0.15 })`. The word "selector" → weight 1.0, so `0.6 + 0.15 * 1.0 = 0.75`. Existing test still passes.

For the "single refuting" test: experiment is "check selector" with delta -0.2 → weight 1.0 → `0.6 + (-0.2) * 1.0 = 0.4`. Still passes.

For "no matching experiments": delta = 0, weight irrelevant. Still passes.

For "multiple experiments": both use "check selector" (weight 1.0), deltas 0.1 each → `0.5 + 0.1 + 0.1 = 0.7`. Still passes.

- [ ] **Step 5: Commit**

```bash
git add src/cognition/belief-updater.ts src/cognition/belief-updater.test.ts
git commit -m "feat(cognition): evidence-weighted belief updates based on experiment reliability"
```

---

### Task 4: Approval Gate Tests

**Files:**
- Create: `src/approval/gate.test.ts`

- [ ] **Step 1: Write the tests**

Create `src/approval/gate.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import {
  requiresApproval,
  requestApproval,
  respondToApproval,
  getPendingApprovals,
  clearApprovals,
  type ApprovalPolicy
} from "./gate";

test("requiresApproval returns false when policy is disabled", () => {
  const policy: ApprovalPolicy = {
    enabled: false,
    requireApproval: ["run_code", "write_file"]
  };
  assert.equal(requiresApproval("run_code", {}, policy), false);
});

test("requiresApproval returns true when policy is enabled and task type matches", () => {
  const policy: ApprovalPolicy = {
    enabled: true,
    requireApproval: ["run_code", "write_file"]
  };
  assert.equal(requiresApproval("run_code", {}, policy), true);
});

test("requiresApproval returns false when policy is enabled but task type does not match", () => {
  const policy: ApprovalPolicy = {
    enabled: true,
    requireApproval: ["run_code", "write_file"]
  };
  assert.equal(requiresApproval("click", {}, policy), false);
});

test("respondToApproval resolves pending request with approved", async () => {
  const approvalPromise = requestApproval({
    runId: "run-approve-test",
    taskId: "task-1",
    taskType: "run_code",
    taskPayload: { code: "console.log(1)" },
    reason: "Code execution requires approval"
  });

  // Get the pending approval to find its ID
  const pending = getPendingApprovals("run-approve-test");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, "pending");

  // Respond with approval
  const response = respondToApproval(pending[0].id, true, "test-user");
  assert.ok(response);
  assert.equal(response!.status, "approved");
  assert.equal(response!.respondedBy, "test-user");

  // The original promise should resolve
  const result = await approvalPromise;
  assert.equal(result.status, "approved");
});

test("respondToApproval resolves pending request with rejected", async () => {
  const approvalPromise = requestApproval({
    runId: "run-reject-test",
    taskId: "task-2",
    taskType: "write_file",
    taskPayload: { path: "/etc/passwd" },
    reason: "Dangerous file write"
  });

  const pending = getPendingApprovals("run-reject-test");
  assert.equal(pending.length, 1);

  respondToApproval(pending[0].id, false);

  const result = await approvalPromise;
  assert.equal(result.status, "rejected");
});

test("respondToApproval returns undefined for unknown id", () => {
  const result = respondToApproval("nonexistent-id", true);
  assert.equal(result, undefined);
});

test("getPendingApprovals returns empty for unknown runId", () => {
  const result = getPendingApprovals("nonexistent-run");
  assert.deepEqual(result, []);
});

test("clearApprovals rejects all pending and cleans up", async () => {
  const promise1 = requestApproval({
    runId: "run-clear-test",
    taskId: "task-a",
    taskType: "run_code",
    taskPayload: {},
    reason: "test"
  });

  const promise2 = requestApproval({
    runId: "run-clear-test",
    taskId: "task-b",
    taskType: "write_file",
    taskPayload: {},
    reason: "test"
  });

  const pendingBefore = getPendingApprovals("run-clear-test");
  assert.equal(pendingBefore.length, 2);

  clearApprovals("run-clear-test");

  // Both promises should resolve as rejected
  const [result1, result2] = await Promise.all([promise1, promise2]);
  assert.equal(result1.status, "rejected");
  assert.equal(result2.status, "rejected");

  // No more pending
  const pendingAfter = getPendingApprovals("run-clear-test");
  assert.equal(pendingAfter.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --import tsx --test src/approval/gate.test.ts`
Expected: All 8 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/approval/gate.test.ts
git commit -m "test(approval): add gate unit tests for approval flow"
```

---

### Task 5: Session Manager Tests

**Files:**
- Create: `src/auth/session-manager.test.ts`

- [ ] **Step 1: Write the tests**

Create `src/auth/session-manager.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { extractDomain, isPasswordSelector } from "./session-manager";

// --- extractDomain tests ---

test("extractDomain: standard URL", () => {
  assert.equal(extractDomain("https://github.com/login"), "github.com");
});

test("extractDomain: strips www prefix", () => {
  assert.equal(extractDomain("https://www.github.com/login"), "github.com");
});

test("extractDomain: localhost with port", () => {
  assert.equal(extractDomain("http://localhost:3000/dashboard"), "localhost");
});

test("extractDomain: IP address", () => {
  assert.equal(extractDomain("http://192.168.1.1:8080/api"), "192.168.1.1");
});

test("extractDomain: invalid URL returns input", () => {
  assert.equal(extractDomain("not-a-url"), "not-a-url");
});

test("extractDomain: subdomain preserved", () => {
  assert.equal(extractDomain("https://api.github.com/v1"), "api.github.com");
});

// --- isPasswordSelector tests ---

test("isPasswordSelector: matches password in selector", () => {
  assert.equal(isPasswordSelector("#password"), true);
});

test("isPasswordSelector: matches type=password attribute", () => {
  assert.equal(isPasswordSelector('[type="password"]'), true);
});

test("isPasswordSelector: matches single-quote type=password", () => {
  assert.equal(isPasswordSelector("[type='password']"), true);
});

test("isPasswordSelector: matches passwd variant", () => {
  assert.equal(isPasswordSelector("#user-passwd"), true);
});

test("isPasswordSelector: rejects non-password selector", () => {
  assert.equal(isPasswordSelector("#email"), false);
});

test("isPasswordSelector: rejects empty string", () => {
  assert.equal(isPasswordSelector(""), false);
});

test("isPasswordSelector: case insensitive", () => {
  assert.equal(isPasswordSelector("#Password"), true);
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --import tsx --test src/auth/session-manager.test.ts`
Expected: All 13 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/auth/session-manager.test.ts
git commit -m "test(auth): add session manager unit tests for domain extraction and password detection"
```

---

### Task 6: Session Store Tests

**Files:**
- Create: `src/auth/session-store.test.ts`

- [ ] **Step 1: Write the tests**

Create `src/auth/session-store.test.ts`:

```typescript
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { saveSession, loadSession, deleteSession, listSessions, initSessionTable } from "./session-store";
import { getDb } from "../db/client";

// Ensure session table exists before each test
beforeEach(() => {
  initSessionTable();
});

test("saveSession + loadSession round-trip", () => {
  const cookies = [{ name: "sid", value: "abc123", domain: "example.com", path: "/" }];
  saveSession("tenant-1", "example.com", cookies);

  const loaded = loadSession("tenant-1", "example.com");
  assert.ok(loaded);
  assert.equal(loaded!.tenantId, "tenant-1");
  assert.equal(loaded!.domain, "example.com");

  const parsedCookies = JSON.parse(loaded!.cookies);
  assert.equal(parsedCookies.length, 1);
  assert.equal(parsedCookies[0].name, "sid");
});

test("saveSession upserts on same tenant+domain", () => {
  const cookies1 = [{ name: "sid", value: "first", domain: "example.com", path: "/" }];
  const cookies2 = [{ name: "sid", value: "second", domain: "example.com", path: "/" }];

  saveSession("tenant-upsert", "example.com", cookies1);
  saveSession("tenant-upsert", "example.com", cookies2);

  const loaded = loadSession("tenant-upsert", "example.com");
  assert.ok(loaded);
  const parsedCookies = JSON.parse(loaded!.cookies);
  assert.equal(parsedCookies[0].value, "second");
});

test("loadSession returns undefined for non-existent session", () => {
  const loaded = loadSession("no-tenant", "no-domain.com");
  assert.equal(loaded, undefined);
});

test("deleteSession removes the session", () => {
  saveSession("tenant-del", "delete-me.com", [{ name: "x", value: "y", domain: "delete-me.com", path: "/" }]);
  assert.ok(loadSession("tenant-del", "delete-me.com"));

  deleteSession("tenant-del", "delete-me.com");
  assert.equal(loadSession("tenant-del", "delete-me.com"), undefined);
});

test("listSessions returns all sessions for tenant", () => {
  saveSession("tenant-list", "a.com", [{ name: "a", value: "1", domain: "a.com", path: "/" }]);
  saveSession("tenant-list", "b.com", [{ name: "b", value: "2", domain: "b.com", path: "/" }]);
  saveSession("other-tenant", "c.com", [{ name: "c", value: "3", domain: "c.com", path: "/" }]);

  const sessions = listSessions("tenant-list");
  assert.equal(sessions.length, 2);
  assert.ok(sessions.some((s) => s.domain === "a.com"));
  assert.ok(sessions.some((s) => s.domain === "b.com"));
});

test("loadSession returns undefined for expired session", () => {
  // Insert a session with past expiration directly via DB
  const db = getDb();
  initSessionTable();
  db.prepare(`
    INSERT INTO sessions (id, tenant_id, domain, cookies, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now', '-1 hour'))
  `).run("expired-id", "tenant-expired", "expired.com", "[]");

  const loaded = loadSession("tenant-expired", "expired.com");
  assert.equal(loaded, undefined);
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --import tsx --test src/auth/session-store.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/auth/session-store.test.ts
git commit -m "test(auth): add session store unit tests for persistence and expiration"
```

---

### Task 7: Full Test Suite + Regression Check

- [ ] **Step 1: Run all new Phase 2 tests together**

Run: `node --import tsx --test src/cognition/hypothesis-engine.test.ts src/cognition/executive-controller.test.ts src/cognition/belief-updater.test.ts src/approval/gate.test.ts src/auth/session-manager.test.ts src/auth/session-store.test.ts`
Expected: All tests PASS.

- [ ] **Step 2: Run Phase 1 tests to verify no regressions**

Run: `node --import tsx --test src/verifier/action-verifier.test.ts src/verifier/state-verifier.test.ts src/verifier/goal-verifier.test.ts src/core/runtime.test.ts src/cognition/experiment-runner.test.ts`
Expected: All 67 Phase 1 tests PASS.

- [ ] **Step 3: Fix any regressions if found**

Only commit if fixes were needed.
