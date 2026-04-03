import type { AgentTask, RunContext } from "../types";
import type { AgentObservation, VerificationResult } from "../cognition/types";

export async function verifyActionResult(
  context: RunContext,
  task: AgentTask,
  observation: AgentObservation
): Promise<VerificationResult> {
  const evidence: string[] = [];
  let passed = true;
  let rationale = "Action result looks plausible.";

  switch (task.type) {
    case "open_page": {
      const expectedUrl = String(task.payload.url ?? "");
      passed = Boolean(
        observation.pageUrl &&
        normalizeUrl(observation.pageUrl).startsWith(normalizeUrl(expectedUrl))
      );
      rationale = passed
        ? "Observed page URL matches the requested open_page target."
        : "Observed page URL does not match the requested open_page target.";
      evidence.push(`expectedUrl=${expectedUrl}`);
      evidence.push(`observedUrl=${observation.pageUrl ?? "none"}`);
      break;
    }

    case "assert_text":
    case "visual_assert": {
      const expectedText = String(task.payload.text ?? "");
      const visible = observation.visibleText?.join(" ") ?? "";
      passed = visible.toLowerCase().includes(expectedText.toLowerCase());
      rationale = passed
        ? "Observed text contains the asserted value."
        : "Observed text does not contain the asserted value.";
      evidence.push(`expectedText=${expectedText}`);
      break;
    }

    case "click":
    case "visual_click":
    case "hover": {
      passed = observation.anomalies.length === 0;
      rationale = passed
        ? `${task.type} completed and no observation anomaly was detected.`
        : `${task.type} completed but the observation engine reported anomalies.`;
      evidence.push(`anomalyCount=${observation.anomalies.length}`);
      break;
    }

    case "type":
    case "visual_type": {
      const typedValue = String(task.payload.value ?? "");
      const visible = observation.visibleText?.join(" ") ?? "";
      passed = visible.toLowerCase().includes(typedValue.toLowerCase());
      rationale = passed
        ? "Typed value appears in the observed visible text."
        : "Typed value was not found in the observed visible text.";
      evidence.push(`expectedValue=${typedValue}`);
      break;
    }

    case "select": {
      const selectedValue = String(task.payload.value ?? "");
      const visible = observation.visibleText?.join(" ") ?? "";
      passed = visible.toLowerCase().includes(selectedValue.toLowerCase());
      rationale = passed
        ? "Selected value appears in the observed visible text."
        : "Selected value was not found in the observed visible text.";
      evidence.push(`expectedValue=${selectedValue}`);
      break;
    }

    case "screenshot": {
      passed = context.artifacts.some(
        (a) => a.type === "screenshot" && a.taskId === task.id
      );
      rationale = passed
        ? "Screenshot artifact was captured for this task."
        : "No screenshot artifact was found for this task.";
      evidence.push(`artifactCount=${context.artifacts.filter((a) => a.taskId === task.id).length}`);
      break;
    }

    case "http_request":
    case "read_file":
    case "write_file":
    case "run_code":
    case "visual_extract": {
      passed = !task.error;
      rationale = passed
        ? `${task.type} completed without error.`
        : `${task.type} failed with error: ${task.error}`;
      evidence.push(`taskError=${task.error ?? "none"}`);
      break;
    }

    case "wait":
    case "wait_for_server":
    case "start_app":
    case "stop_app": {
      passed = true;
      rationale = `${task.type} is verified by the state verifier.`;
      break;
    }

    default: {
      passed = observation.anomalies.length === 0;
      rationale = passed
        ? "Unknown task type completed without anomalies."
        : "Unknown task type completed with anomalies.";
      evidence.push(`anomalyCount=${observation.anomalies.length}`);
      break;
    }
  }

  return {
    runId: context.runId,
    taskId: task.id,
    verifier: "action",
    passed,
    confidence: passed ? 0.8 : 0.55,
    rationale,
    evidence
  };
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
