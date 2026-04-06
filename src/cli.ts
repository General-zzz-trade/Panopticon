import { Logger } from "./logger";
import { runGoal, RunOptions } from "./core/runtime";
import { createConversation, recordTurn, buildContinuationContext, endConversation, getConversationSummary } from "./session/conversation";
import { runExploreCommand } from "./exploration/explore-command";
import { runParallelGoal } from "./orchestration/parallel-command";
import { isReactConfigured, runReactGoal } from "./core/react-loop";
import { isComputerUseConfigured, runComputerUseGoal } from "./computer-use/agent";
import { generateGoalSuggestions, getKnowledgeSummary } from "./cognition/curiosity";
import * as readline from "readline";

function printUsage(): void {
  console.log("Panopticon");
  console.log("");
  console.log("Usage:");
  console.log('  npm run dev -- "<goal>"');
  console.log('  npm start -- "<goal>"');
  console.log('  npm run dev -- --session       # Interactive multi-turn mode');
  console.log('  npm run dev -- --explore <url>  # Autonomous website exploration');
  console.log('  npm run dev -- --parallel "<goal>"  # Multi-agent parallel execution');
  console.log('  npm run dev -- --react "<goal>"   # LLM-driven ReAct mode');
  console.log('  npm run dev -- --computer-use "<goal>"  # Claude Computer Use mode');
  console.log('  npm run dev -- --suggest          # Show autonomous goal suggestions');
  console.log("");
  console.log("Example:");
  console.log(
    '  npm run dev -- "start app \\"npm run dev\\" and wait for server \\"http://localhost:3000\\" and open page \\"http://localhost:3000\\" and click \\"text=Login\\" and assert text \\"Dashboard\\" and screenshot and stop app"'
  );
}

async function main(): Promise<void> {
  const [, , ...args] = process.argv;
  const logger = new Logger();

  if (args.includes("--suggest")) {
    const summary = getKnowledgeSummary();
    console.log("=== Agent Knowledge Summary ===");
    console.log(`Episodes: ${summary.totalEpisodes} (${Math.round(summary.successRate * 100)}% success)`);
    console.log(`Knowledge entries: ${summary.totalKnowledge}`);
    console.log(`Known domains: ${summary.knownDomains.join(", ") || "none"}`);
    console.log("\n=== Suggested Next Goals ===");
    if (summary.suggestions.length === 0) {
      console.log("No suggestions yet. Run some goals first to build knowledge.");
    }
    for (const s of summary.suggestions) {
      console.log(`  [${(s.priority * 100).toFixed(0)}%] ${s.goal}`);
      console.log(`        ${s.reason} (${s.source})`);
    }
    return;
  }

  if (args.includes("--session")) {
    await runSessionMode(logger);
    return;
  }

  const exploreIdx = args.indexOf("--explore");
  if (exploreIdx !== -1) {
    const url = args[exploreIdx + 1];
    if (!url) {
      console.error("Usage: --explore <url>");
      process.exitCode = 1;
      return;
    }
    await runExploreCommand(url, logger);
    return;
  }

  if (args.includes("--parallel")) {
    const remaining = args.filter(a => a !== "--parallel").join(" ").trim();
    if (!remaining) {
      console.error('Usage: --parallel "<goal>"');
      process.exitCode = 1;
      return;
    }
    await runParallelGoal(remaining, logger);
    return;
  }

  if (args.includes("--react")) {
    const remaining = args.filter(a => a !== "--react").join(" ").trim();
    if (!remaining) {
      console.error('Usage: --react "<goal>"');
      process.exitCode = 1;
      return;
    }
    if (!isReactConfigured()) {
      console.error("ReAct mode requires LLM_REACT_PROVIDER and LLM_REACT_API_KEY environment variables.");
      process.exitCode = 1;
      return;
    }
    const result = await runReactGoal(remaining);
    console.log(result.success ? "Goal achieved!" : "Goal not achieved.");
    console.log(result.message);
    console.log(`\nSteps taken: ${result.totalSteps}`);
    for (const step of result.steps) {
      console.log(`  [${step.step}] ${step.thought.slice(0, 80)}`);
      console.log(`       ${step.action}: ${step.success ? "OK" : "FAIL"} ${step.result.slice(0, 60)}`);
    }
    return;
  }

  if (args.includes("--computer-use") || args.includes("--cu")) {
    const flagIdx = Math.max(args.indexOf("--computer-use"), args.indexOf("--cu"));
    const remaining = args.filter((_, i) => i !== flagIdx).join(" ").trim();
    if (!remaining) {
      console.error('Usage: --computer-use "<goal>"');
      process.exitCode = 1;
      return;
    }
    if (!isComputerUseConfigured()) {
      console.error("Computer Use mode requires ANTHROPIC_API_KEY environment variable.");
      process.exitCode = 1;
      return;
    }

    // Extract --url flag if present
    const urlIdx = args.indexOf("--url");
    const startUrl = urlIdx !== -1 ? args[urlIdx + 1] : undefined;
    const goalText = args.filter((_, i) => i !== flagIdx && i !== urlIdx && (urlIdx === -1 || i !== urlIdx + 1)).join(" ").trim();

    logger.info(`Computer Use mode: ${goalText}`);
    const result = await runComputerUseGoal(goalText, { startUrl });

    console.log(result.success ? "\n✓ Goal achieved!" : "\n✗ Goal not achieved.");
    console.log(result.message);
    console.log(`\nSteps: ${result.totalSteps}`);
    for (const step of result.steps) {
      console.log(`  [${step.step}] ${step.action}: ${step.detail}`);
    }
    console.log(`\nTokens: ${result.totalTokens.input} input + ${result.totalTokens.output} output`);
    return;
  }

  const goal = args.join(" ").trim();

  if (!goal) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  logger.info(`Goal received: ${goal}`);
  const run = await runGoal(goal);
  printRunResult(run, logger);
}

async function runSessionMode(logger: Logger): Promise<void> {
  const conversation = createConversation();
  console.log(`Session started: ${conversation.id}`);
  console.log('Type a goal and press Enter. Type "exit" or "quit" to end.');
  console.log("");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const prompt = (): Promise<string> =>
    new Promise((resolve) => rl.question("goal> ", resolve));

  try {
    while (true) {
      const goal = (await prompt()).trim();

      if (!goal) continue;
      if (goal === "exit" || goal === "quit") break;
      if (goal === "status") {
        console.log(getConversationSummary(conversation));
        continue;
      }

      const continuation = buildContinuationContext(conversation);
      if (continuation.previousTurns) {
        logger.info(`Continuing session with ${conversation.turns.length} prior turn(s)`);
      }

      const options: RunOptions = {
        browserSession: continuation.browserSession,
        worldState: continuation.worldState,
        keepBrowserAlive: true
      };
      const run = await runGoal(goal, options);
      recordTurn(conversation, run);
      printRunResult(run, logger);
      console.log("");
    }
  } finally {
    await endConversation(conversation);
    console.log(getConversationSummary(conversation));
    rl.close();
  }
}

function printRunResult(run: Awaited<ReturnType<typeof runGoal>>, logger: Logger): void {
  const reflection = run.reflection;

  if (run.result?.success) {
    logger.info("Task completed successfully.");
    console.log(run.result.message);
    console.log("");
    console.log("Reflection summary:");
    console.log(reflection?.summary ?? "No reflection available.");
    console.log("Improvement suggestions:");
    for (const suggestion of reflection?.improvementSuggestions ?? []) {
      console.log(`- ${suggestion}`);
    }
    return;
  }

  logger.error("Task failed.");
  console.error(run.result?.message ?? "Task failed.");
  console.error("");
  console.error("Reflection summary:");
  console.error(reflection?.summary ?? "No reflection available.");
  console.error("Improvement suggestions:");
  for (const suggestion of reflection?.improvementSuggestions ?? []) {
    console.error(`- ${suggestion}`);
  }
  process.exitCode = 1;
}

void main();
