import { lookup } from "node:dns/promises";
import { createDiagnoserFromEnv, isLowQualityDiagnoserOutput, validateLLMDiagnoserOutput } from "./llm/diagnoser";
import { createPlannerFromEnv, validateLLMPlannerOutput } from "./llm/planner";
import { createReplannerFromEnv, validateLLMReplannerOutput } from "./llm/replanner";
import type { AgentTask } from "./types";
import { logModuleError } from "./core/module-logger";

async function main(): Promise<void> {
  const apiKey = process.env.MOONSHOT_API_KEY?.trim();
  if (!apiKey) {
    console.error("Missing MOONSHOT_API_KEY.");
    process.exitCode = 1;
    return;
  }

  const model = process.env.MOONSHOT_MODEL?.trim() || "kimi-k2.5";
  const baseUrl = process.env.MOONSHOT_BASE_URL?.trim() || "https://api.moonshot.ai/v1";
  const timeoutMs = process.env.MOONSHOT_TIMEOUT_MS?.trim() || "30000";

  applyMoonshotEnv("LLM_PLANNER", apiKey, model, baseUrl, timeoutMs);
  applyMoonshotEnv("LLM_REPLANNER", apiKey, model, baseUrl, timeoutMs);
  applyMoonshotEnv("LLM_DIAGNOSER", apiKey, model, baseUrl, timeoutMs);

  console.log(`Moonshot verification config: model=${model} baseUrl=${baseUrl}`);
  await printNetworkPreflight(baseUrl);

  let failed = false;

  failed = !(await verifyPlanner()) || failed;
  failed = !(await verifyReplanner()) || failed;
  failed = !(await verifyDiagnoser()) || failed;

  if (failed) {
    process.exitCode = 1;
  }
}

function applyMoonshotEnv(prefix: string, apiKey: string, model: string, baseUrl: string, timeoutMs: string): void {
  process.env[`${prefix}_PROVIDER`] = "openai-compatible";
  process.env[`${prefix}_API_KEY`] = apiKey;
  process.env[`${prefix}_MODEL`] = model;
  process.env[`${prefix}_BASE_URL`] = baseUrl;
  process.env[`${prefix}_TIMEOUT_MS`] = timeoutMs;
}

async function printNetworkPreflight(baseUrl: string): Promise<void> {
  const hostname = extractHostname(baseUrl);
  if (!hostname) {
    console.log("network: invalid base URL");
    return;
  }

  try {
    const result = await lookup(hostname);
    console.log(`network: dns ok hostname=${hostname} address=${result.address}`);
  } catch (error) {
    const detail = classifyNetworkError(error);
    console.log(`network: dns failed hostname=${hostname} reason=${detail}`);
  }

  const httpProxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY;
  console.log(`network: proxy=${httpProxy ? "configured" : "none"}`);
}

async function verifyPlanner(): Promise<boolean> {
  const planner = createPlannerFromEnv();
  if (!planner) {
    console.error("Planner provider did not initialize.");
    return false;
  }

  try {
    const tasks = await planner.plan({
      goal: 'open "https://example.com" and click login and assert text "Dashboard"',
      recentRunsSummary: [],
      failurePatterns: []
    });
    const valid = validateLLMPlannerOutput(tasks);
    console.log(`planner: valid=${valid} tasks=${tasks.length}`);
    return valid && tasks.length > 0;
  } catch (error) {
    console.error(`planner: failed -> ${classifyNetworkError(error)}`);
    return false;
  }
}

async function verifyReplanner(): Promise<boolean> {
  const replanner = createReplannerFromEnv();
  if (!replanner) {
    console.error("Replanner provider did not initialize.");
    return false;
  }

  const currentTask: AgentTask = {
    id: "verify-replanner-click",
    type: "click",
    status: "failed",
    retries: 0,
    attempts: 1,
    replanDepth: 0,
    payload: { selector: "#login-button" },
    errorHistory: ["selector moved after redesign"]
  };

  try {
    const tasks = await replanner.replan({
      goal: 'open "https://example.com" and click login and assert text "Dashboard"',
      currentTask,
      currentError: "failure=selector not found | failureType=selector_mismatch | topHypothesis=selector_drift | recoveryPrior=use visual_click",
      recentRunsSummary: [],
      failurePatterns: [],
      currentTaskListSnapshot: [currentTask]
    });
    const valid = validateLLMReplannerOutput(tasks);
    console.log(`replanner: valid=${valid} tasks=${tasks.length}`);
    return valid;
  } catch (error) {
    console.error(`replanner: failed -> ${classifyNetworkError(error)}`);
    return false;
  }
}

async function verifyDiagnoser(): Promise<boolean> {
  const diagnoser = createDiagnoserFromEnv();
  if (!diagnoser) {
    console.error("Diagnoser provider did not initialize.");
    return false;
  }

  try {
    const output = await diagnoser.diagnose({
      goal: 'open "https://example.com" and click login and assert text "Dashboard"',
      tasks: [
        {
          id: "verify-diagnoser-open",
          type: "open_page",
          status: "done",
          retries: 0,
          attempts: 1,
          replanDepth: 0,
          payload: { url: "https://example.com" }
        },
        {
          id: "verify-diagnoser-click",
          type: "click",
          status: "failed",
          retries: 1,
          attempts: 2,
          replanDepth: 0,
          payload: { selector: "#login-button" },
          errorHistory: ["selector not found"]
        }
      ],
      metrics: {
        totalTasks: 2,
        doneTasks: 1,
        failedTasks: 1,
        totalRetries: 1,
        totalReplans: 1,
        averageTaskDurationMs: 300
      },
      failurePatterns: [],
      recentRunsSummary: [],
      terminationReason: "task_failure"
    });
    const valid = validateLLMDiagnoserOutput(output) && !isLowQualityDiagnoserOutput(output);
    console.log(`diagnoser: valid=${valid} risks=${output.topRisks.length} suggestions=${output.suggestedNextImprovements.length}`);
    return valid;
  } catch (error) {
    console.error(`diagnoser: failed -> ${classifyNetworkError(error)}`);
    return false;
  }
}

function extractHostname(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).hostname;
  } catch (error) {
    logModuleError("verify-moonshot", "optional", error, "extracting hostname from base URL");
    return undefined;
  }
}

function classifyNetworkError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause && typeof cause === "object") {
      const networkCause = cause as { code?: string; message?: string; hostname?: string };
      if (networkCause.code === "EAI_AGAIN") {
        return `dns lookup failed (${networkCause.hostname ?? "unknown host"}): ${networkCause.code}`;
      }
      if (networkCause.code === "ENOTFOUND") {
        return `host not found (${networkCause.hostname ?? "unknown host"}): ${networkCause.code}`;
      }
      if (networkCause.code === "ECONNREFUSED") {
        return `connection refused: ${networkCause.message ?? networkCause.code}`;
      }
      if (networkCause.code === "ETIMEDOUT") {
        return `network timeout: ${networkCause.message ?? networkCause.code}`;
      }
    }

    return error.message;
  }

  return String(error);
}

void main();
