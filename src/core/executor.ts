import { handleAssertTask } from "../handlers/assert-handler";
import { handleBrowserTask, TaskExecutionOutput } from "../handlers/browser-handler";
import { handleHttpTask } from "../handlers/http-handler";
import { handleReadFileTask, handleWriteFileTask } from "../handlers/file-handler";
import { handleShellTask } from "../handlers/shell-handler";
import { handleVisionTask } from "../handlers/vision-handler";
import { Logger } from "../logger";
import { captureRetryFailureArtifact, getRetryPolicy, waitBeforeRetry } from "./retry";
import { AgentTask, RunContext } from "../types";
import { getActionHandler } from "../plugins/registry";
import { getTool, toolRequiresApproval as registryRequiresApproval } from "../tools/registry";
import { getSynthesizedTool, synthesizeTool, buildToolExecutionCode } from "../tools/synthesizer";
import { logModuleError } from "./module-logger";

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
  // Integration: Tools registry — validate parameters and check approval requirements
  const toolDef = getTool(task.type);
  if (toolDef) {
    // Validate required parameters
    for (const param of toolDef.parameters) {
      if (param.required && (task.payload as Record<string, unknown>)[param.name] == null) {
        throw new Error(`Task ${task.id} (${task.type}) missing required parameter: ${param.name}`);
      }
    }

    // Registry-driven approval check (supplements policy-based check below)
    if (registryRequiresApproval(task.type) && context.policy?.approval?.enabled) {
      const { requestApproval } = await import("../approval/gate");
      const approval = await requestApproval({
        runId: context.runId,
        taskId: task.id,
        taskType: task.type,
        taskPayload: task.payload as Record<string, unknown>,
        reason: `Tool "${task.type}" is marked as requiring approval in the tools registry`
      });
      if (approval.status === "rejected") {
        throw new Error(`Task ${task.id} rejected by human reviewer (registry-required approval)`);
      }
    }
  }

  // Check if human approval is required before executing this task (policy-based)
  if (context.policy?.approval?.enabled) {
    const { requiresApproval, requestApproval } = await import("../approval/gate");
    if (requiresApproval(task.type, task.payload as Record<string, unknown>, context.policy.approval)) {
      const approval = await requestApproval({
        runId: context.runId,
        taskId: task.id,
        taskType: task.type,
        taskPayload: task.payload as Record<string, unknown>,
        reason: `Task type "${task.type}" requires human approval`
      });
      if (approval.status === "rejected") {
        throw new Error(`Task ${task.id} rejected by human reviewer`);
      }
    }
  }

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

  if (task.type === "http_request") {
    return handleHttpTask(context, task);
  }
  if (task.type === "read_file") {
    return handleReadFileTask(context, task);
  }
  if (task.type === "write_file") {
    return handleWriteFileTask(context, task);
  }

  if (task.type === "run_code") {
    const { handleCodeTask } = await import("../handlers/code-handler");
    return handleCodeTask(context, task);
  }

  if (task.type === "start_app" || task.type === "wait_for_server" || task.type === "stop_app") {
    return handleShellTask(context, task, logger);
  }

  // Check if this is a previously synthesized tool
  const synthesized = getSynthesizedTool(task.type);
  if (synthesized) {
    return executeSynthesizedTool(context, task, synthesized, logger);
  }

  // For known browser actions, use the browser handler
  const browserActions = new Set([
    "open_page", "click", "type", "select", "scroll", "hover", "wait", "screenshot"
  ]);
  if (browserActions.has(task.type)) {
    return handleBrowserTask(context, task, logger);
  }

  // Unknown task type — try to synthesize a new tool on the fly
  logger.info(`Unknown task type "${task.type}" — attempting tool synthesis`);
  try {
    const newTool = await synthesizeTool(
      `Execute a "${task.type}" action with parameters: ${JSON.stringify(task.payload)}`,
      `This is part of the goal: ${context.goal}`
    );
    if (newTool) {
      logger.info(`Synthesized new tool: ${newTool.definition.name}`);
      return executeSynthesizedTool(context, task, newTool, logger);
    }
  } catch (error) {
    logModuleError("tool-synthesis", "optional", error, `synthesizing handler for ${task.type}`);
  }

  // Final fallback: try browser handler (may work for custom selectors etc.)
  return handleBrowserTask(context, task, logger);
}

async function executeSynthesizedTool(
  context: RunContext,
  task: AgentTask,
  tool: import("../tools/synthesizer").SynthesizedTool,
  logger: Logger
): Promise<TaskExecutionOutput> {
  const { language, code } = buildToolExecutionCode(tool, task.payload as Record<string, unknown>);
  logger.info(`Executing synthesized tool "${tool.definition.name}" (${language})`);

  // Execute via the code handler
  const codeTask: AgentTask = {
    ...task,
    type: "run_code",
    payload: { language, code }
  };
  const { handleCodeTask } = await import("../handlers/code-handler");
  return handleCodeTask(context, codeTask);
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
