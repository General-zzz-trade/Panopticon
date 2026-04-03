import type { AgentTask, RunContext } from "../types";
import type { AgentObservation, VerificationResult } from "../cognition/types";

export async function verifyStateResult(
  context: RunContext,
  task: AgentTask,
  observation: AgentObservation
): Promise<VerificationResult> {
  const evidence: string[] = [];
  let passed = true;
  let rationale = "State remains internally consistent.";

  if (task.type === "wait_for_server") {
    // wait_for_server does not require a browser page — it only checks HTTP availability.
    // The "no browser page" anomaly is expected before open_page and should not fail this task.
    passed = !task.error;
    rationale = passed
      ? "Server wait completed — HTTP endpoint is reachable."
      : `Server wait failed: ${task.error}`;
  } else if (task.type === "start_app") {
    passed = Boolean(context.appProcess);
    rationale = passed
      ? "Application process handle is attached after start_app."
      : "Application process handle is missing after start_app.";
  } else if (task.type === "stop_app") {
    passed = !context.appProcess;
    rationale = passed
      ? "Application process handle is cleared after stop_app."
      : "Application process handle is still attached after stop_app.";
  } else if (task.type === "open_page") {
    const observedUrl = observation.pageUrl ?? "";
    const worldUrl = context.worldState?.pageUrl ?? "";
    if (observedUrl && worldUrl) {
      passed = normalizeUrl(observedUrl) === normalizeUrl(worldUrl);
      rationale = passed
        ? "Observed page URL is consistent with world state."
        : "Observed page URL diverges from world state — possible navigation inconsistency.";
    }
  }

  evidence.push(`appStateGuess=${observation.appStateGuess ?? "unknown"}`);
  evidence.push(`pageUrl=${observation.pageUrl ?? "none"}`);

  return {
    runId: context.runId,
    taskId: task.id,
    verifier: "state",
    passed,
    confidence: passed ? 0.75 : 0.6,
    rationale,
    evidence
  };
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
