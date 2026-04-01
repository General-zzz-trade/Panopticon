import { FailurePattern } from "./memory";
import { AgentTask, RunMetrics, RunContext, TerminationReason } from "./types";

export interface RecentRunSummary {
  runId: string;
  goal: string;
  success: boolean;
  terminationReason?: TerminationReason;
  failedTaskTypes: AgentTask["type"][];
}

export interface LLMDiagnoserInput {
  goal: string;
  tasks: AgentTask[];
  metrics?: RunMetrics;
  failurePatterns: FailurePattern[];
  recentRunsSummary: RecentRunSummary[];
  terminationReason?: TerminationReason;
}

export interface LLMDiagnoserOutput {
  diagnosis: string;
  topRisks: string[];
  suggestedNextImprovements: string[];
}

export interface LLMDiagnoserConfig {
  provider: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
  apiKey?: string;
  baseUrl?: string;
}

export interface LLMDiagnoser {
  readonly config: LLMDiagnoserConfig;
  diagnose(input: LLMDiagnoserInput): Promise<LLMDiagnoserOutput>;
}

export function createDiagnoserFromEnv(): LLMDiagnoser | undefined {
  const provider = process.env.LLM_DIAGNOSER_PROVIDER?.trim();
  if (!provider) {
    return undefined;
  }

  const config: LLMDiagnoserConfig = {
    provider,
    model: process.env.LLM_DIAGNOSER_MODEL?.trim() || "gpt-4.1-mini",
    timeoutMs: Number(process.env.LLM_DIAGNOSER_TIMEOUT_MS ?? 8000),
    maxTokens: Number(process.env.LLM_DIAGNOSER_MAX_TOKENS ?? 400),
    temperature: Number(process.env.LLM_DIAGNOSER_TEMPERATURE ?? 0.1),
    apiKey: process.env.LLM_DIAGNOSER_API_KEY?.trim(),
    baseUrl: process.env.LLM_DIAGNOSER_BASE_URL?.trim()
  };

  if (provider === "mock") {
    return createMockDiagnoser(config);
  }

  if (provider === "openai-compatible") {
    if (!config.apiKey || !config.baseUrl) {
      return undefined;
    }

    return createOpenAICompatibleDiagnoser(config);
  }

  return undefined;
}

export function summarizeRecentRuns(runs: RunContext[]): RecentRunSummary[] {
  return runs.map((run) => ({
    runId: run.runId,
    goal: run.goal,
    success: run.result?.success ?? false,
    terminationReason: run.terminationReason,
    failedTaskTypes: run.tasks.filter((task) => task.status === "failed").map((task) => task.type)
  }));
}

export function validateLLMDiagnoserOutput(output: LLMDiagnoserOutput): boolean {
  return Boolean(output.diagnosis.trim()) && Array.isArray(output.topRisks) && Array.isArray(output.suggestedNextImprovements);
}

export function isLowQualityDiagnoserOutput(output: LLMDiagnoserOutput): boolean {
  return output.diagnosis.trim().length < 24 || output.topRisks.length === 0 || output.suggestedNextImprovements.length === 0;
}

function createMockDiagnoser(config: LLMDiagnoserConfig): LLMDiagnoser {
  return {
    config,
    async diagnose(input: LLMDiagnoserInput): Promise<LLMDiagnoserOutput> {
      const unstableTaskType = input.failurePatterns[0]?.taskType ?? "none";
      const diagnosis = `Mock LLM diagnosis: termination=${input.terminationReason ?? "unknown"}, unstableTaskType=${unstableTaskType}, recentRuns=${input.recentRunsSummary.length}.`;

      const topRisks = [
        `Most unstable task type: ${unstableTaskType}`,
        `Run ended with: ${input.terminationReason ?? "unknown"}`
      ];

      const suggestedNextImprovements = [
        "Stabilize selectors and readiness checks before increasing automation scope.",
        "Review recent failed runs and compare task timing against successful runs."
      ];

      return {
        diagnosis,
        topRisks,
        suggestedNextImprovements
      };
    }
  };
}

function createOpenAICompatibleDiagnoser(config: LLMDiagnoserConfig): LLMDiagnoser {
  return {
    config,
    async diagnose(input: LLMDiagnoserInput): Promise<LLMDiagnoserOutput> {
      const responseText = await postDiagnoseRequest(config, input);
      const parsed = safeJsonParse(responseText);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("LLM diagnoser response was not a JSON object.");
      }

      const normalized = normalizeDiagnoserOutput(parsed);
      if (!normalized) {
        throw new Error("LLM diagnoser output failed schema validation.");
      }

      return normalized;
    }
  };
}

async function postDiagnoseRequest(config: LLMDiagnoserConfig, input: LLMDiagnoserInput): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.baseUrl!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a constrained run diagnoser. Return JSON only as {\"diagnosis\":string,\"topRisks\":string[],\"suggestedNextImprovements\":string[]}."
          },
          {
            role: "user",
            content: JSON.stringify(input)
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`LLM diagnoser HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("LLM diagnoser returned empty content.");
    }

    return content;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`LLM diagnoser timed out after ${config.timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeDiagnoserOutput(value: unknown): LLMDiagnoserOutput | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as {
    diagnosis?: unknown;
    topRisks?: unknown;
    suggestedNextImprovements?: unknown;
  };

  if (typeof candidate.diagnosis !== "string") {
    return undefined;
  }

  if (!Array.isArray(candidate.topRisks) || !Array.isArray(candidate.suggestedNextImprovements)) {
    return undefined;
  }

  const topRisks = candidate.topRisks.filter((item): item is string => typeof item === "string");
  const suggestedNextImprovements = candidate.suggestedNextImprovements.filter(
    (item): item is string => typeof item === "string"
  );

  return {
    diagnosis: candidate.diagnosis,
    topRisks,
    suggestedNextImprovements
  };
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
