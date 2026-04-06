import { logModuleError } from "../core/module-logger";
import { FailurePattern } from "../memory";
import { AgentTask, RunMetrics, RunContext, TerminationReason } from "../types";
import {
  LLMProviderConfig,
  callOpenAICompatible,
  callAnthropic,
  readProviderConfig,
  safeJsonParse
} from "./provider";
import { selectPrompt, recordPromptOutcome } from "../learning/prompt-evolver";

export type LLMDiagnoserConfig = LLMProviderConfig;

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

export interface LLMDiagnoser {
  readonly config: LLMDiagnoserConfig;
  diagnose(input: LLMDiagnoserInput): Promise<LLMDiagnoserOutput>;
}

const DIAGNOSER_SYSTEM_PROMPT =
  "You are an OSINT investigation diagnoser. Return JSON only as {\"diagnosis\":string,\"topRisks\":string[],\"suggestedNextImprovements\":string[]}.";

export function createDiagnoserFromEnv(): LLMDiagnoser | undefined {
  const config = readProviderConfig("LLM_DIAGNOSER", { maxTokens: 400 });
  if (!config.provider) {
    return undefined;
  }

  if (config.provider === "mock") {
    return createMockDiagnoser(config);
  }

  if (config.provider === "openai-compatible") {
    if (!config.apiKey || !config.baseUrl) {
      return undefined;
    }

    return createOpenAICompatibleDiagnoser(config);
  }

  if (config.provider === "anthropic") {
    if (!config.apiKey) {
      return undefined;
    }

    return createAnthropicDiagnoser(config);
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
      let selectedPrompt: { id: string; systemPrompt: string } | undefined;
      if (!process.env.DISABLE_PROMPT_EVOLUTION) try {
        selectedPrompt = selectPrompt("diagnoser") ?? undefined;
      } catch (error) { logModuleError("diagnoser", "optional", error, "prompt selection"); }
      const systemPrompt = selectedPrompt?.systemPrompt ?? DIAGNOSER_SYSTEM_PROMPT;

      let raw: string;
      try {
        const result = await callOpenAICompatible(
          config,
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(input) }
          ],
          "LLM diagnoser"
        );
        raw = result.content;
      } catch (err) {
        if (selectedPrompt) {
          try { recordPromptOutcome(selectedPrompt.id, false); } catch (error) { logModuleError("diagnoser", "optional", error, "recording prompt outcome on call failure"); }
        }
        throw err;
      }

      const parsed = safeJsonParse(raw);
      if (!parsed || typeof parsed !== "object") {
        if (selectedPrompt) {
          try { recordPromptOutcome(selectedPrompt.id, false); } catch (error) { logModuleError("diagnoser", "optional", error, "recording prompt outcome on parse failure"); }
        }
        throw new Error("LLM diagnoser response was not a JSON object.");
      }

      const normalized = normalizeDiagnoserOutput(parsed);
      if (!normalized) {
        if (selectedPrompt) {
          try { recordPromptOutcome(selectedPrompt.id, false); } catch (error) { logModuleError("diagnoser", "optional", error, "recording prompt outcome on validation failure"); }
        }
        throw new Error("LLM diagnoser output failed schema validation.");
      }

      if (selectedPrompt) {
        try { recordPromptOutcome(selectedPrompt.id, true); } catch (error) { logModuleError("diagnoser", "optional", error, "recording prompt outcome on success"); }
      }

      return normalized;
    }
  };
}

function createAnthropicDiagnoser(config: LLMDiagnoserConfig): LLMDiagnoser {
  return {
    config,
    async diagnose(input: LLMDiagnoserInput): Promise<LLMDiagnoserOutput> {
      let selectedPrompt: { id: string; systemPrompt: string } | undefined;
      if (!process.env.DISABLE_PROMPT_EVOLUTION) try {
        selectedPrompt = selectPrompt("diagnoser") ?? undefined;
      } catch (error) { logModuleError("diagnoser", "optional", error, "prompt selection"); }
      const systemPrompt = selectedPrompt?.systemPrompt ?? DIAGNOSER_SYSTEM_PROMPT;

      let raw: string;
      try {
        const result = await callAnthropic(
          config,
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(input) }
          ],
          "LLM diagnoser"
        );
        raw = result.content;
      } catch (err) {
        if (selectedPrompt) {
          try { recordPromptOutcome(selectedPrompt.id, false); } catch (error) { logModuleError("diagnoser", "optional", error, "recording prompt outcome on call failure"); }
        }
        throw err;
      }

      const parsed = safeJsonParse(raw);
      if (!parsed || typeof parsed !== "object") {
        if (selectedPrompt) {
          try { recordPromptOutcome(selectedPrompt.id, false); } catch (error) { logModuleError("diagnoser", "optional", error, "recording prompt outcome on parse failure"); }
        }
        throw new Error("LLM diagnoser response was not a JSON object.");
      }

      const normalized = normalizeDiagnoserOutput(parsed);
      if (!normalized) {
        if (selectedPrompt) {
          try { recordPromptOutcome(selectedPrompt.id, false); } catch (error) { logModuleError("diagnoser", "optional", error, "recording prompt outcome on validation failure"); }
        }
        throw new Error("LLM diagnoser output failed schema validation.");
      }

      if (selectedPrompt) {
        try { recordPromptOutcome(selectedPrompt.id, true); } catch (error) { logModuleError("diagnoser", "optional", error, "recording prompt outcome on success"); }
      }

      return normalized;
    }
  };
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
