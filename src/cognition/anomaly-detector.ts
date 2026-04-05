/**
 * Anomaly Detector — identifies unexpected state transitions after task execution.
 * Compares predicted outcomes (from causal graph) with actual observations.
 * Generates human-readable suggestions when anomalies are detected.
 */

import type { AgentTask, RunContext } from "../types";
import type { AgentObservation } from "./types";
import { diffObservations } from "../vision/visual-diff";
import { analyzeSceneFromText } from "../vision/scene-analyzer";
import { logModuleError } from "../core/module-logger";

export interface Anomaly {
  type: "unexpected_state" | "missing_transition" | "error_signal" | "regression" | "stale_page";
  severity: "low" | "medium" | "high";
  description: string;
  evidence: string[];
  suggestion: string;
}

export interface AnomalyReport {
  anomalies: Anomaly[];
  overallRisk: "none" | "low" | "medium" | "high";
  summary: string;
}

/**
 * Detect anomalies by comparing pre and post task observations.
 */
export function detectAnomalies(
  task: AgentTask,
  beforeObs: AgentObservation,
  afterObs: AgentObservation,
  context: RunContext
): AnomalyReport {
  const anomalies: Anomaly[] = [];

  // 1. Check for error signals in post-observation
  checkErrorSignals(afterObs, anomalies);

  // 2. Check for unexpected lack of change (stale page)
  checkStaleState(task, beforeObs, afterObs, anomalies);

  // 3. Check for regression (was authenticated, now seeing login)
  checkRegression(beforeObs, afterObs, anomalies);

  // 4. Check for unexpected navigation
  checkUnexpectedNavigation(task, beforeObs, afterObs, anomalies);

  // 5. Check repeated failures
  checkRepeatedFailures(task, context, anomalies);

  // Scene-based anomaly: detect error pages and unexpected page types
  if (afterObs.sceneDescription) {
    const scene = afterObs.sceneDescription;
    if (scene.pageType === "error") {
      anomalies.push({
        type: "error_signal",
        description: `Scene analysis detected an error page (confidence: ${scene.confidence.toFixed(2)})`,
        severity: "high",
        evidence: [`sceneDescription.pageType=error`],
        suggestion: "Check if the previous action caused a server error or navigation to a 404 page"
      });
    }
    if (scene.pageType === "loading" && task.type !== "wait" && task.type !== "open_page") {
      anomalies.push({
        type: "unexpected_state",
        description: `Scene analysis shows page is still loading after ${task.type} action`,
        severity: "medium",
        evidence: [`sceneDescription.pageType=loading`],
        suggestion: "Consider adding a wait before the next action"
      });
    }
  }

  const overallRisk = computeOverallRisk(anomalies);
  const summary = anomalies.length === 0
    ? "No anomalies detected."
    : `${anomalies.length} anomaly(ies) detected: ${anomalies.map(a => a.type).join(", ")}`;

  return { anomalies, overallRisk, summary };
}

function checkErrorSignals(obs: AgentObservation, anomalies: Anomaly[]): void {
  const text = (obs.visibleText ?? []).join(" ");

  if (/error\s*\d{3}|internal server error|500|503|502/i.test(text)) {
    anomalies.push({
      type: "error_signal",
      severity: "high",
      description: "HTTP error code detected in page content.",
      evidence: [`visibleText contains error signal`],
      suggestion: "The server may be experiencing issues. Consider retrying after a delay or checking server health."
    });
  }

  if (/exception|stack\s*trace|traceback|unhandled/i.test(text)) {
    anomalies.push({
      type: "error_signal",
      severity: "high",
      description: "Exception or stack trace visible on page.",
      evidence: [`visibleText contains exception markers`],
      suggestion: "An unhandled error occurred. Capture a screenshot for debugging and consider reporting this issue."
    });
  }

  if (/access denied|forbidden|unauthorized|not authorized/i.test(text)) {
    anomalies.push({
      type: "error_signal",
      severity: "medium",
      description: "Access denied or authorization error detected.",
      evidence: [`visibleText contains auth error`],
      suggestion: "The current session may have expired. Try re-authenticating before retrying."
    });
  }
}

function checkStaleState(
  task: AgentTask,
  before: AgentObservation,
  after: AgentObservation,
  anomalies: Anomaly[]
): void {
  // Actions that should change something
  const mutatingActions = new Set(["click", "type", "select", "visual_click", "visual_type", "open_page"]);
  if (!mutatingActions.has(task.type)) return;

  const diff = diffObservations(before, after);
  if (!diff.changed && diff.changeScore === 0) {
    anomalies.push({
      type: "stale_page",
      severity: "medium",
      description: `${task.type} action completed but no observable change occurred.`,
      evidence: [`changeScore=0`, `urlChanged=${diff.urlChanged}`],
      suggestion: "The action may not have had the intended effect. Verify the target element exists and is interactive."
    });
  }
}

function checkRegression(
  before: AgentObservation,
  after: AgentObservation,
  anomalies: Anomaly[]
): void {
  const beforeScene = analyzeSceneFromText(before.visibleText ?? []);
  const afterScene = analyzeSceneFromText(after.visibleText ?? []);

  // Regression: was on dashboard/authenticated, now on login
  if (
    (beforeScene.pageType === "dashboard" && afterScene.pageType === "login") ||
    (before.appStateGuess === "authenticated" && /login|sign in/i.test((after.visibleText ?? []).join(" ")))
  ) {
    anomalies.push({
      type: "regression",
      severity: "high",
      description: "Session appears to have been lost — went from authenticated state back to login.",
      evidence: [`before: ${beforeScene.pageType}`, `after: ${afterScene.pageType}`],
      suggestion: "The session expired or was invalidated. Re-authenticate before continuing."
    });
  }
}

function checkUnexpectedNavigation(
  task: AgentTask,
  before: AgentObservation,
  after: AgentObservation,
  anomalies: Anomaly[]
): void {
  if (task.type === "open_page") return; // navigation is expected

  if (before.pageUrl && after.pageUrl && before.pageUrl !== after.pageUrl) {
    // Unexpected navigation during a non-navigation action
    const beforePath = extractPath(before.pageUrl);
    const afterPath = extractPath(after.pageUrl);

    if (beforePath !== afterPath) {
      anomalies.push({
        type: "unexpected_state",
        severity: "low",
        description: `Page navigated from ${beforePath} to ${afterPath} during ${task.type} — this may be expected but wasn't explicitly requested.`,
        evidence: [`before=${before.pageUrl}`, `after=${after.pageUrl}`],
        suggestion: "Verify the navigation was intentional. If unexpected, the page may have a redirect or auto-navigation behavior."
      });
    }
  }
}

function checkRepeatedFailures(
  task: AgentTask,
  context: RunContext,
  anomalies: Anomaly[]
): void {
  const sameTypeFailed = context.tasks.filter(
    t => t.type === task.type && t.status === "failed"
  ).length;

  if (sameTypeFailed >= 3) {
    anomalies.push({
      type: "regression",
      severity: "high",
      description: `Task type "${task.type}" has failed ${sameTypeFailed} times in this run.`,
      evidence: [`failedCount=${sameTypeFailed}`],
      suggestion: "This task type is consistently failing. Consider switching strategy (e.g., visual fallback) or requesting human assistance."
    });
  }
}

function computeOverallRisk(anomalies: Anomaly[]): AnomalyReport["overallRisk"] {
  if (anomalies.length === 0) return "none";
  if (anomalies.some(a => a.severity === "high")) return "high";
  if (anomalies.some(a => a.severity === "medium")) return "medium";
  return "low";
}

function extractPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch (error) {
    logModuleError("anomaly-detector", "optional", error, "parsing URL path");
    return url;
  }
}
