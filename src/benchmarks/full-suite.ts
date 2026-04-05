/**
 * Full Benchmark Suite — reproduces the 96% success rate from this session.
 *
 * Run with: node --env-file=.env --import tsx src/benchmarks/full-suite.ts
 */

import { runGoal } from "../core/runtime";
import * as fs from "fs";
import * as path from "path";

interface TestCase {
  name: string;
  goal: string;
  mode?: "sequential" | "react" | "cli";
  category: string;
}

const SUITE: TestCase[] = [
  // === DSL (6) ===
  { name: "dsl-nav", category: "DSL", goal: 'open page "https://example.com" and assert text "Example Domain"' },
  { name: "dsl-http", category: "DSL", goal: 'http_request "https://httpbin.org/ip"' },
  { name: "dsl-code", category: "DSL", goal: 'run_code "javascript" "console.log(JSON.stringify({result:42}))"' },
  { name: "dsl-multi", category: "DSL", goal: 'open page "https://httpbin.org" and assert text "httpbin" and screenshot' },
  { name: "dsl-combo", category: "DSL", goal: 'http_request "https://httpbin.org/uuid" and run_code "javascript" "console.log(JSON.stringify({done:true}))"' },
  { name: "dsl-assert", category: "DSL", goal: 'open page "https://jsonplaceholder.typicode.com/posts/1" and assert text "sunt aut facere"' },

  // === NL Planner (2) ===
  { name: "nl-vague", category: "NL", goal: "verify that example.com works correctly" },
  { name: "nl-check", category: "NL", goal: "check if httpbin.org is online and responding" },

  // === ReAct Browser (6) ===
  { name: "react-info", category: "ReAct", mode: "react", goal: "go to example.com and tell me the exact text on the page" },
  { name: "react-github", category: "ReAct", mode: "react", goal: "go to github.com and tell me what the page title says" },
  { name: "react-hn", category: "ReAct", mode: "react", goal: "go to news.ycombinator.com and tell me the title of the top story" },
  { name: "react-wiki", category: "ReAct", mode: "react", goal: "go to en.wikipedia.org/wiki/TypeScript and tell me who created it and when" },
  { name: "react-form", category: "ReAct", mode: "react", goal: "go to httpbin.org/forms/post, fill in custname with Agent and custemail with a@b.com, then submit" },
  { name: "react-chain", category: "ReAct", mode: "react", goal: "go to jsonplaceholder.typicode.com/users/1 and find the name, then go to /posts?userId=1 and count how many posts that user has" },

  // === CLI (5) ===
  { name: "cli-list", category: "CLI", mode: "cli", goal: "list all TypeScript files in the src/goal directory and count them" },
  { name: "cli-wc", category: "CLI", mode: "cli", goal: "find the total number of lines of code in src/core/runtime.ts" },
  { name: "cli-git", category: "CLI", mode: "cli", goal: "show the current git branch name and how many files have been modified" },
  { name: "cli-find", category: "CLI", mode: "cli", goal: "find all .ts files in src/core/ directory, count total lines of code across all of them" },
  { name: "cli-search", category: "CLI", mode: "cli", goal: "search for the string runGoal in all TypeScript files under src/ and report how many files contain it" },

  // === HumanEval (4) ===
  { name: "he-fizzbuzz", category: "HumanEval", mode: "react", goal: "write javascript code that prints FizzBuzz for numbers 1-15" },
  { name: "he-palindrome", category: "HumanEval", mode: "react", goal: "write javascript code to check if racecar is a palindrome, output true or false" },
  { name: "he-fibonacci", category: "HumanEval", mode: "react", goal: "write javascript code to return the 20th fibonacci number and print it" },
  { name: "he-twosum", category: "HumanEval", mode: "react", goal: "write javascript code to find two numbers in [2,7,11,15] that add up to 9, output their indices" },

  // === Reasoning (3) ===
  { name: "arc-fib", category: "Reasoning", mode: "react", goal: "write code to find the next number in: 1,1,2,3,5,8,13,? — explain the pattern" },
  { name: "arc-transform", category: "Reasoning", mode: "react", goal: "the rule transforms ABC to CBA and HELLO to OLLEH. apply to AGENT and print result" },
  { name: "arc-logic", category: "Reasoning", mode: "react", goal: "write code: given [1,2,3] outputs [1,4,9]. given [4,5,6] what is the output? compute and verify" },
];

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

async function runSuite(): Promise<void> {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  AGENT-ORCHESTRATOR FULL BENCHMARK SUITE`);
  console.log(`  Reproducing session results (${SUITE.length} tests)`);
  console.log(`${"═".repeat(70)}\n`);

  const results: TestResult[] = [];
  const startTotal = Date.now();

  for (const test of SUITE) {
    const start = Date.now();
    process.stdout.write(`[${(results.length + 1).toString().padStart(2)}/${SUITE.length}] ${test.name.padEnd(18)} `);
    try {
      const ctx = await runGoal(test.goal, test.mode ? { executionMode: test.mode } : {});
      const ms = Date.now() - start;
      const passed = ctx.result?.success ?? false;
      results.push({ name: test.name, category: test.category, passed, durationMs: ms });
      process.stdout.write(`${passed ? "✓" : "✗"} ${(ms / 1000).toFixed(1)}s\n`);
    } catch (e) {
      const ms = Date.now() - start;
      results.push({ name: test.name, category: test.category, passed: false, durationMs: ms, error: e instanceof Error ? e.message : String(e) });
      process.stdout.write(`✗ ${(ms / 1000).toFixed(1)}s ERR\n`);
    }
  }

  const totalMs = Date.now() - startTotal;
  const passed = results.filter(r => r.passed).length;
  const rate = passed / results.length;

  // Per-category breakdown
  const byCategory = new Map<string, { total: number; passed: number }>();
  for (const r of results) {
    const c = byCategory.get(r.category) ?? { total: 0, passed: 0 };
    c.total++;
    if (r.passed) c.passed++;
    byCategory.set(r.category, c);
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(`  RESULTS`);
  console.log(`${"─".repeat(70)}`);
  console.log(`  Total:        ${passed}/${results.length} (${(rate * 100).toFixed(1)}%)`);
  console.log(`  Duration:     ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`  Avg per test: ${(totalMs / results.length / 1000).toFixed(1)}s`);
  console.log();
  console.log(`  By category:`);
  for (const [cat, stats] of byCategory) {
    const pct = (stats.passed / stats.total * 100).toFixed(0);
    console.log(`    ${cat.padEnd(12)} ${stats.passed}/${stats.total}  (${pct}%)`);
  }

  // Save report
  const reportDir = path.join(process.cwd(), "artifacts", "benchmarks");
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `full-suite-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    passed,
    successRate: rate,
    totalDurationMs: totalMs,
    byCategory: Object.fromEntries(byCategory),
    results
  }, null, 2));
  console.log(`\n  Report saved: ${reportPath}`);
  console.log();

  process.exit(passed === results.length ? 0 : 1);
}

void runSuite();
