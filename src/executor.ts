import { handleAssertTask } from "./handlers/assert-handler";
import { handleBrowserTask, TaskExecutionOutput } from "./handlers/browser-handler";
import { handleShellTask } from "./handlers/shell-handler";
import { handleVisionTask } from "./handlers/vision-handler";
import { Logger } from "./logger";
import { captureRetryFailureArtifact, getRetryPolicy, waitBeforeRetry } from "./retry";
import { AgentTask, RunContext } from "./types";
import { getActionHandler } from "./plugins/registry";

export async function executeTask(
  context: RunContext,
  task: AgentTask,
  logger = new Logger()
): Promise<TaskExecutionOutput> {
  const retryPolicy = getRetryPolicy(task);

  while (true) {
    task.status = "running";
    task.startedAt ??= new Date().toISOString();
    task.attempts += 1;
    task.errorHistory ??= [];

    try {
      const output = await dispatchTask(context, task, logger);
      task.status = "done";
      task.endedAt = new Date().toISOString();
      task.durationMs = calculateDurationMs(task.startedAt, task.endedAt);
      task.error = undefined;
      return output;
    } catch (error) {
      const message = getErrorMessage(error);
      task.error = message;
      task.errorHistory.push(message);

      if (task.retries < retryPolicy.maxRetries) {
        task.retries += 1;
        logger.info(`Task ${task.id} failed: ${message}`);
        const retryArtifact = await captureRetryFailureArtifact(context, task);
        if (retryArtifact) {
          context.artifacts.push(retryArtifact);
        }
        logger.info(`Retrying ${task.id} (${task.type}) after failure: ${message}`);
        await waitBeforeRetry(retryPolicy.retryDelayMs);
        continue;
      }

      task.status = "failed";
      task.endedAt = new Date().toISOString();
      task.durationMs = calculateDurationMs(task.startedAt, task.endedAt);
      throw error;
    }
  }
}

async function dispatchTask(
  context: RunContext,
  task: AgentTask,
  logger: Logger
): Promise<TaskExecutionOutput> {
  // Check plugin registry first (allows overriding built-in actions)
  const pluginHandler = getActionHandler(task.type);
  if (pluginHandler) {
    const output = await pluginHandler.execute(context, task);
    for (const artifact of output.artifacts ?? []) {
      context.artifacts.push({ ...artifact, taskId: task.id });
    }
    return { summary: output.summary };
  }

  if (task.type === "assert_text") {
    return handleAssertTask(context, task, logger);
  }

  if (task.type === "visual_click" || task.type === "visual_type" ||
      task.type === "visual_assert" || task.type === "visual_extract") {
    return handleVisionTask(context, task, logger);
  }

  if (task.type === "start_app" || task.type === "wait_for_server" || task.type === "stop_app") {
    return handleShellTask(context, task, logger);
  }

  return handleBrowserTask(context, task, logger);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function calculateDurationMs(startedAt?: string, endedAt?: string): number | undefined {
  if (!startedAt || !endedAt) {
    return undefined;
  }

  return new Date(endedAt).getTime() - new Date(startedAt).getTime();
}
