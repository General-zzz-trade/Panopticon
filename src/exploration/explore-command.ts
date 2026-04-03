/**
 * CLI explore command — autonomous website discovery.
 * Usage: npm run dev -- --explore "http://localhost:3000"
 *
 * Opens a real browser, observes the page, systematically clicks elements,
 * records state transitions into the causal graph.
 */

import { Logger } from "../logger";
import { planExploration, createExplorationReport, DEFAULT_EXPLORATION_CONFIG } from "./explorer";
import type { ExploredPage, ExplorationAction, ExplorationConfig } from "./explorer";
import { createBrowserSession, openPage, clickElement, closeBrowserSession } from "../browser";
import type { BrowserSession } from "../browser";
import { observeEnvironment, materializeObservation } from "../cognition/observation-engine";
import { createCausalGraph, addStateNode, addCausalEdge } from "../world-model/causal-graph";
import { saveCausalGraph } from "../world-model/persistence";
import type { RunContext } from "../types";
import type { AgentObservation } from "../cognition/types";

export async function runExploreCommand(url: string, logger: Logger): Promise<void> {
  logger.info(`Starting autonomous exploration of: ${url}`);
  const config: ExplorationConfig = { ...DEFAULT_EXPLORATION_CONFIG };
  const graph = createCausalGraph();
  const visitedUrls = new Set<string>();
  const pages: ExploredPage[] = [];
  const actions: ExplorationAction[] = [];
  let session: BrowserSession | undefined;

  try {
    // Launch real browser and navigate to start URL
    session = await createBrowserSession();
    logger.info("Browser launched");

    const title = await openPage(session, url);
    visitedUrls.add(url);

    // Create a minimal RunContext for the observation engine
    const observationContext: RunContext = {
      runId: `explore-${Date.now().toString(36)}`,
      goal: `explore ${url}`,
      tasks: [],
      artifacts: [],
      replanCount: 0,
      nextTaskSequence: 0,
      insertedTaskCount: 0,
      llmReplannerInvocations: 0,
      llmReplannerTimeoutCount: 0,
      llmReplannerFallbackCount: 0,
      escalationDecisions: [],
      limits: { maxReplansPerRun: 0, maxReplansPerTask: 0 },
      startedAt: new Date().toISOString(),
      browserSession: session
    };

    // Observe the starting page
    const startObservation = await observeEnvironment(observationContext);
    const startElements = startObservation.actionableElements ?? [];
    logger.info(`Start page: "${title}" — ${startElements.length} actionable elements`);

    pages.push({
      url,
      title,
      pageType: inferPageType(startObservation),
      elements: startElements,
      visitCount: 1,
      discoveredAt: 0
    });

    // Plan exploration from real observations
    const plan = planExploration(url, startElements, visitedUrls, config);
    logger.info(`Exploration plan: ${plan.actions.length} actions to try`);

    const hostname = new URL(url).hostname;
    const startState = deriveState(startObservation);
    addStateNode(graph, startState, hostname);

    // Execute each planned action on the real page
    let step = 0;
    for (const planned of plan.actions) {
      if (step >= config.maxSteps) break;

      const fromUrl = session.page.url();
      const fromState = deriveState(await observeEnvironment(observationContext));

      try {
        if (planned.type === "click" || planned.type === "navigate") {
          await clickElement(session, planned.target);
          // Wait for navigation or DOM update
          await session.page.waitForTimeout(500);
        }

        const toUrl = session.page.url();
        const afterObservation = await observeEnvironment(observationContext);
        const toState = deriveState(afterObservation);
        const success = true;

        addStateNode(graph, fromState, hostname);
        addStateNode(graph, toState, hostname);
        addCausalEdge(graph, fromState, toState, planned.type, planned.target, hostname, success);

        actions.push({
          step,
          action: planned.type,
          target: planned.target,
          fromUrl,
          toUrl,
          fromState,
          toState,
          success,
          description: `${planned.type} "${planned.description}"`
        });

        // Track new pages
        if (!visitedUrls.has(toUrl)) {
          visitedUrls.add(toUrl);
          const pageTitle = await session.page.title();
          pages.push({
            url: toUrl,
            title: pageTitle,
            pageType: inferPageType(afterObservation),
            elements: afterObservation.actionableElements ?? [],
            visitCount: 1,
            discoveredAt: step
          });
        }

        logger.info(`  [${step}] ${planned.type} "${planned.description}" → ${toUrl}`);

        // Navigate back if we left the start page (breadth-first exploration)
        if (toUrl !== fromUrl) {
          try {
            await session.page.goBack({ waitUntil: "domcontentloaded" });
            await session.page.waitForTimeout(300);
          } catch {
            // If back fails, navigate directly
            await openPage(session, fromUrl);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        logger.info(`  [${step}] ${planned.type} "${planned.description}" — FAILED: ${message}`);

        addStateNode(graph, fromState, hostname);
        addCausalEdge(graph, fromState, `error:${planned.type}`, planned.type, planned.target, hostname, false);

        actions.push({
          step,
          action: planned.type,
          target: planned.target,
          fromUrl,
          toUrl: fromUrl,
          fromState,
          toState: `error:${planned.type}`,
          success: false,
          description: `${planned.type} "${planned.description}" — ${message}`
        });
      }

      step++;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    logger.error(`Exploration failed: ${message}`);
    // Fall back to mock-based exploration if browser unavailable
    logger.info("Falling back to plan-only mode (no browser)");
    const mockPlan = planExploration(url, [], new Set(), config);
    console.log(`\nPlanned ${mockPlan.actions.length} actions (browser unavailable for execution)`);
  } finally {
    await closeBrowserSession(session);
  }

  const report = createExplorationReport(url, pages, actions, graph);

  // Save causal graph for future runs
  saveCausalGraph(graph);

  console.log("\n=== Exploration Report ===");
  console.log(report.summary);
  console.log(`\nPages discovered: ${report.pagesDiscovered.length}`);
  for (const page of report.pagesDiscovered) {
    console.log(`  - ${page.url} (${page.title}, ${page.elements.length} elements)`);
  }
  console.log(`\nActions performed: ${report.actionsPerformed.length}`);
  const successCount = actions.filter(a => a.success).length;
  console.log(`  Success: ${successCount}/${actions.length}`);
  console.log(`\nCausal graph: ${graph.nodes.size} states, ${graph.edges.size} edges`);
  if (report.anomalies.length > 0) {
    console.log(`\nAnomalies:`);
    for (const anomaly of report.anomalies) {
      console.log(`  - ${anomaly}`);
    }
  }
  console.log(`\nCausal graph saved to artifacts/causal-graph.json`);
}

function deriveState(observation: AgentObservation): string {
  const parts: string[] = [];
  if (observation.pageUrl) {
    try {
      parts.push(`page:${new URL(observation.pageUrl).pathname}`);
    } catch {
      parts.push(`page:${observation.pageUrl}`);
    }
  }
  if (observation.appStateGuess && observation.appStateGuess !== "unknown") {
    parts.push(`app:${observation.appStateGuess}`);
  }
  const text = (observation.visibleText ?? []).join(" ").toLowerCase();
  if (/dashboard|home|welcome/i.test(text)) parts.push("content:dashboard");
  else if (/login|sign in/i.test(text)) parts.push("content:login");
  else if (/error|failed|not found/i.test(text)) parts.push("content:error");
  return parts.length > 0 ? parts.join("|") : "state:unknown";
}

function inferPageType(observation: AgentObservation): string {
  const text = (observation.visibleText ?? []).join(" ").toLowerCase();
  if (/login|sign in|log in/i.test(text)) return "login";
  if (/dashboard|home|welcome/i.test(text)) return "dashboard";
  if (/error|404|not found/i.test(text)) return "error";
  if (/settings|profile|account/i.test(text)) return "settings";
  return "content";
}
