/**
 * CLI Agent — LLM-driven persistent shell automation.
 *
 * Maintains a live bash session. The LLM sees command outputs
 * and decides what to run next. Supports cd, pipes, env vars,
 * multi-step workflows, and reading previous output.
 */

import { readProviderConfig, callOpenAICompatible, callAnthropic, safeJsonParse } from "../llm/provider";
import { createShellSession, runCommand, closeShellSession, type ShellSession } from "../handlers/shell-session";
import { logModuleError } from "../core/module-logger";

export interface CLIAgentOptions {
  maxSteps?: number;
  cwd?: string;
  timeoutPerCommand?: number;
}

export interface CLIStep {
  step: number;
  thought: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  success: boolean;
}

export interface CLIResult {
  success: boolean;
  message: string;
  steps: CLIStep[];
  totalSteps: number;
}

const SYSTEM_PROMPT = `You are a CLI automation agent with a persistent bash shell. You run commands and see their output to accomplish goals.

Respond with JSON:
{"thought": "your reasoning", "command": "the shell command to run"}

When the goal is achieved:
{"thought": "explanation of result", "command": "done"}

RULES:
1. You have a PERSISTENT shell — cd, export, variables carry across commands
2. Read command output carefully before deciding the next command
3. Use pipes and redirects freely: grep, awk, sed, sort, wc, etc.
4. If a command fails, read stderr and adjust
5. Be efficient — chain commands with && or pipes when possible
6. For file operations, use cat/head/tail to verify results
7. NEVER run destructive commands (rm -rf /, etc.) without explicit user request`;

/**
 * Check if CLI agent is available.
 */
export function isCLIAgentConfigured(): boolean {
  const config = readProviderConfig("LLM_REACT", { maxTokens: 4000, temperature: 0 });
  return Boolean(config.provider && config.apiKey);
}

/**
 * Run a goal using persistent shell automation.
 */
export async function runCLIGoal(
  goal: string,
  options: CLIAgentOptions = {}
): Promise<CLIResult> {
  const maxSteps = options.maxSteps ?? 20;
  const timeoutPerCommand = options.timeoutPerCommand ?? 30000;
  const config = readProviderConfig("LLM_REACT", { maxTokens: 4000, temperature: 0 });

  if (!config.provider || !config.apiKey) {
    return { success: false, message: "No LLM configured", steps: [], totalSteps: 0 };
  }

  const session = createShellSession(undefined, options.cwd);
  const steps: CLIStep[] = [];
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT }
  ];

  try {
    for (let step = 0; step < maxSteps; step++) {
      // Build context
      const context = step === 0
        ? `Goal: ${goal}\n\nWorking directory: ${options.cwd ?? process.cwd()}\n\nWhat command should we run first?`
        : `Command output:\nstdout: ${steps[step - 1].stdout.slice(0, 1500)}\nstderr: ${steps[step - 1].stderr.slice(0, 500)}\nexit code: ${steps[step - 1].exitCode}\n\nWhat next?`;

      messages.push({ role: "user", content: context });

      // Ask LLM
      let responseText: string;
      try {
        const result = config.provider === "anthropic"
          ? await callAnthropic(config, messages, "CLIAgent")
          : await callOpenAICompatible(config, messages, "CLIAgent");
        responseText = result.content;
      } catch (error) {
        logModuleError("cli-agent", "optional", error, "LLM call failed");
        return { success: false, message: "LLM failed to respond", steps, totalSteps: step };
      }

      const parsed = safeJsonParse(responseText) as { thought?: string; command?: string } | null;
      if (!parsed?.command) {
        return { success: false, message: `Unparseable: ${responseText.slice(0, 100)}`, steps, totalSteps: step };
      }

      // Done?
      if (parsed.command === "done") {
        return { success: true, message: parsed.thought ?? "Goal achieved", steps, totalSteps: step };
      }

      // Execute
      const result = await runCommand(session, parsed.command, timeoutPerCommand);

      steps.push({
        step,
        thought: parsed.thought ?? "",
        command: parsed.command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        success: result.exitCode === 0
      });

      messages.push({ role: "user", content: `Assistant: ${responseText}` });
    }

    return { success: false, message: `Reached maximum steps (${maxSteps})`, steps, totalSteps: maxSteps };
  } finally {
    closeShellSession(session.id);
  }
}
