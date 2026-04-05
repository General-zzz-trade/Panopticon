/**
 * Criteria Verifier — checks structured success criteria against observations.
 *
 * Used by GoalVerifier as Strategy 0 (highest priority) when a parsed Goal
 * has explicit successCriteria.
 */

import type { AgentObservation } from "../cognition/types";
import type { RunContext } from "../types";
import type { SuccessCriterion, CriteriaVerificationResult } from "./types";

/**
 * Verify all success criteria against the current observation and context.
 */
export function verifyCriteria(
  criteria: SuccessCriterion[],
  observation: AgentObservation,
  context: RunContext
): CriteriaVerificationResult {
  if (criteria.length === 0) {
    return { met: 0, total: 0, passed: false, confidence: 0, details: [] };
  }

  const details = criteria.map(criterion => {
    const result = verifySingleCriterion(criterion, observation, context);
    return { criterion, ...result };
  });

  const met = details.filter(d => d.met).length;
  const total = details.length;

  // Weighted confidence: weight each criterion by its own confidence
  const totalWeight = criteria.reduce((s, c) => s + c.confidence, 0);
  const metWeight = details
    .filter(d => d.met)
    .reduce((s, d) => s + d.criterion.confidence, 0);
  const confidence = totalWeight > 0 ? metWeight / totalWeight : 0;

  // Pass if all high-confidence criteria met, or >= 80% of weighted criteria met
  const highConfidenceCriteria = criteria.filter(c => c.confidence >= 0.8);
  const highConfidenceMet = details
    .filter(d => d.criterion.confidence >= 0.8 && d.met).length;
  const allHighMet = highConfidenceCriteria.length === 0 || highConfidenceMet === highConfidenceCriteria.length;
  const passed = allHighMet && confidence >= 0.8;

  return { met, total, passed, confidence, details };
}

function verifySingleCriterion(
  criterion: SuccessCriterion,
  observation: AgentObservation,
  context: RunContext
): { met: boolean; evidence: string } {
  switch (criterion.type) {
    case "text_present": {
      const visible = (observation.visibleText ?? []).join(" ").toLowerCase();
      const target = criterion.value.toLowerCase();
      const met = visible.includes(target);
      return { met, evidence: met ? `Found "${criterion.value}" in page` : `"${criterion.value}" not found in visible text` };
    }

    case "text_absent": {
      const visible = (observation.visibleText ?? []).join(" ").toLowerCase();
      const target = criterion.value.toLowerCase();
      const met = !visible.includes(target);
      return { met, evidence: met ? `"${criterion.value}" correctly absent` : `"${criterion.value}" found but should be absent` };
    }

    case "url_reached": {
      const pageUrl = observation.pageUrl ?? context.worldState?.pageUrl ?? "";
      const met = normalizeUrl(pageUrl).includes(normalizeUrl(criterion.value));
      return { met, evidence: met ? `URL matches ${criterion.value}` : `Current URL ${pageUrl} does not match ${criterion.value}` };
    }

    case "element_exists": {
      const elements = observation.actionableElements ?? [];
      const met = elements.some(el =>
        el.selector === criterion.value ||
        el.text?.includes(criterion.value) ||
        el.role === criterion.value
      );
      return { met, evidence: met ? `Element "${criterion.value}" found` : `Element "${criterion.value}" not in observed elements` };
    }

    case "state_reached": {
      const appState = observation.appStateGuess ?? context.worldState?.appState ?? "unknown";
      const met = appState.toLowerCase() === criterion.value.toLowerCase();
      return { met, evidence: met ? `App state is "${appState}"` : `App state is "${appState}", expected "${criterion.value}"` };
    }

    case "http_status": {
      // Check if any task with this URL completed successfully
      const httpTasks = context.tasks.filter(t =>
        t.type === "http_request" &&
        String(t.payload.url ?? "").includes(criterion.value) &&
        t.status === "done"
      );
      const met = httpTasks.length > 0;
      return { met, evidence: met ? `HTTP request to ${criterion.value} succeeded` : `No successful HTTP request to ${criterion.value}` };
    }

    case "file_exists": {
      const fileTasks = context.tasks.filter(t =>
        (t.type === "read_file" || t.type === "write_file") &&
        String(t.payload.path ?? "").includes(criterion.value) &&
        t.status === "done"
      );
      const met = fileTasks.length > 0;
      return { met, evidence: met ? `File operation on ${criterion.value} succeeded` : `No successful file operation on ${criterion.value}` };
    }

    case "custom": {
      // Custom criteria can't be verified mechanically; mark as unmet with low confidence
      return { met: false, evidence: `Custom criterion "${criterion.value}" requires LLM verification` };
    }

    default:
      return { met: false, evidence: `Unknown criterion type: ${criterion.type}` };
  }
}

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, "").replace(/^https?:\/\//, "");
}
