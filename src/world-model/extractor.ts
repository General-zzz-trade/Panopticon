/**
 * Extracts causal triples from completed RunContext objects
 * and adds them to the causal graph.
 */

import { logModuleError } from "../core/module-logger";
import type { RunContext } from "../types";
import type { CausalGraph } from "./causal-graph";
import { addStateNode, addCausalEdge } from "./causal-graph";
import { encodeObservation, assignCluster } from "./state-encoder";
import type { AgentObservation } from "../cognition/types";

/**
 * Extract causal transitions from a completed run.
 * Each task that succeeded produces a (pre_state, action, post_state) triple.
 */
export function extractCausalTransitions(
  context: RunContext,
  graph: CausalGraph
): number {
  const domain = extractDomain(context);
  const observations = context.observations ?? [];
  let extracted = 0;

  for (let i = 0; i < context.tasks.length; i++) {
    const task = context.tasks[i];
    if (task.status !== "done") continue;

    // Find pre and post observations for this task
    const preObs = observations.find(
      o => o.taskId === task.id && o.source === "task_observe"
    );
    // Post observation is the next observation for this task
    const postObsIndex = observations.findIndex(
      o => o.taskId === task.id && o.source === "task_observe"
    );
    const postObs = postObsIndex >= 0
      ? observations.find((o, idx) => idx > postObsIndex && o.taskId === task.id)
      : undefined;

    const preState = deriveState(preObs, task.type, "pre");
    const postState = deriveState(postObs, task.type, "post");

    if (preState !== postState) {
      addStateNode(graph, preState, domain);
      addStateNode(graph, postState, domain);
      addCausalEdge(
        graph,
        preState,
        postState,
        task.type,
        String(task.payload.selector ?? task.payload.url ?? task.payload.text ?? ""),
        domain,
        true
      );
      extracted += 1;
    }
  }

  // Also extract from failed tasks
  for (const task of context.tasks) {
    if (task.status !== "failed" || !task.error) continue;

    const preObs = observations.find(o => o.taskId === task.id);
    const preState = deriveState(preObs, task.type, "pre");

    addStateNode(graph, preState, domain);
    addCausalEdge(
      graph,
      preState,
      `error:${task.type}`,
      task.type,
      String(task.payload.selector ?? task.payload.url ?? ""),
      domain,
      false
    );
  }

  return extracted;
}

function deriveState(
  observation: { pageUrl?: string; appStateGuess?: string; visibleText?: string[] } | undefined,
  taskType: string,
  phase: "pre" | "post"
): string {
  if (!observation) return `${phase}:unknown`;

  const parts: string[] = [];

  if (observation.pageUrl) {
    try {
      const path = new URL(observation.pageUrl).pathname;
      parts.push(`page:${path}`);
    } catch (error) {
      logModuleError("extractor", "optional", error, "URL parsing in state derivation");
      parts.push(`page:${observation.pageUrl}`);
    }
  }

  if (observation.appStateGuess && observation.appStateGuess !== "unknown") {
    parts.push(`app:${observation.appStateGuess}`);
  }

  // Key visible text signals
  const text = (observation.visibleText ?? []).join(" ").toLowerCase();
  if (/dashboard|home|welcome/i.test(text)) parts.push("content:dashboard");
  else if (/login|sign in/i.test(text)) parts.push("content:login");
  else if (/error|failed/i.test(text)) parts.push("content:error");

  return parts.length > 0 ? parts.join("|") : `${phase}:empty`;
}

/**
 * Derive state with embedding: combines the string state representation
 * with a vector embedding and cluster assignment.
 */
export function deriveStateWithEmbedding(
  observation: AgentObservation | undefined,
  taskType: string,
  phase: "pre" | "post",
  domain: string = ""
): { stateString: string; embedding: number[]; clusterId: string } {
  const stateString = deriveState(observation, taskType, phase);

  if (!observation) {
    const zeroEmbedding = new Array(128).fill(0);
    return { stateString, embedding: zeroEmbedding, clusterId: "" };
  }

  const embedding = encodeObservation(observation);
  const cluster = assignCluster(embedding, stateString, domain);

  return { stateString, embedding, clusterId: cluster.id };
}

function extractDomain(context: RunContext): string {
  const openPage = context.tasks.find(t => t.type === "open_page");
  if (openPage?.payload.url) {
    try {
      return new URL(String(openPage.payload.url)).hostname.replace(/^www\./, "");
    } catch (error) { logModuleError("extractor", "optional", error, "URL domain extraction"); }
  }
  return "";
}
