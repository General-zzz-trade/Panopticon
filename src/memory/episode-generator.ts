import type { RunContext } from "../types";

/**
 * Generate a concise natural language summary of a completed run.
 * No LLM needed — structured template from run data.
 */
export function generateEpisodeSummary(context: RunContext): string {
  const parts: string[] = [];
  const success = context.result?.success ?? false;

  parts.push(`Goal: ${context.goal.slice(0, 200)}`);
  parts.push(`Outcome: ${success ? "SUCCESS" : "FAILURE"}`);

  const taskTypes = [...new Set(context.tasks.map(t => t.type))];
  parts.push(`Tasks: ${context.tasks.length} (${taskTypes.join(", ")})`);

  const failedTasks = context.tasks.filter(t => t.status === "failed");
  if (failedTasks.length > 0) {
    const failures = failedTasks
      .map(t => `${t.type}${t.error ? `: ${t.error.slice(0, 80)}` : ""}`)
      .join("; ");
    parts.push(`Failures: ${failures}`);
  }

  if (context.replanCount > 0) {
    parts.push(`Replans: ${context.replanCount}`);
  }

  const hypotheses = context.hypotheses ?? [];
  if (hypotheses.length > 0) {
    const topHypothesis = hypotheses[0];
    parts.push(`Top hypothesis: ${topHypothesis.kind} (${topHypothesis.confidence.toFixed(2)})`);
  }

  if (context.reflection?.diagnosis) {
    parts.push(`Diagnosis: ${context.reflection.diagnosis.slice(0, 150)}`);
  }

  return parts.join(". ");
}

export function extractDomainFromRun(context: RunContext): string {
  const openPage = context.tasks.find(t => t.type === "open_page");
  if (openPage?.payload.url) {
    try {
      return new URL(String(openPage.payload.url)).hostname.replace(/^www\./, "");
    } catch { /* fall through */ }
  }
  return "";
}
