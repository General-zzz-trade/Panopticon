import { takeScreenshot } from "../browser";
import { AgentTask, RunArtifact, RunContext } from "../types";

export interface RetryPolicy {
  maxRetries: number;
  retryDelayMs: number;
  captureFailureScreenshot: boolean;
}

const DEFAULT_POLICY: RetryPolicy = {
  maxRetries: 0,
  retryDelayMs: 1000,
  captureFailureScreenshot: false
};

const RETRY_POLICIES: Partial<Record<AgentTask["type"], RetryPolicy>> = {
  click: {
    maxRetries: 2,
    retryDelayMs: 1000,
    captureFailureScreenshot: true
  },
  type: {
    maxRetries: 1,
    retryDelayMs: 500,
    captureFailureScreenshot: true
  },
  select: {
    maxRetries: 1,
    retryDelayMs: 500,
    captureFailureScreenshot: false
  },
  assert_text: {
    maxRetries: 2,
    retryDelayMs: 1000,
    captureFailureScreenshot: true
  }
};

export function getRetryPolicy(task: AgentTask): RetryPolicy {
  return RETRY_POLICIES[task.type] ?? DEFAULT_POLICY;
}

export async function captureRetryFailureArtifact(
  context: RunContext,
  task: AgentTask
): Promise<RunArtifact | undefined> {
  const policy = getRetryPolicy(task);

  if (!policy.captureFailureScreenshot || !context.browserSession) {
    return undefined;
  }

  const outputPath = `artifacts/retries/${context.runId}-${task.id}-attempt-${task.attempts}.png`;
  await takeScreenshot(context.browserSession, outputPath);

  return {
    type: "retry_failure_screenshot",
    path: outputPath,
    description: `Failure screenshot before retry for ${task.id}`,
    taskId: task.id
  };
}

export async function waitBeforeRetry(durationMs = 1000): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}
