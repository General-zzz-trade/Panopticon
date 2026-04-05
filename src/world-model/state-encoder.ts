/**
 * State Encoder — converts observations into embedding vectors
 * for semantic state comparison, loop detection, and causal graph enhancement.
 */

import { logModuleError } from "../core/module-logger";
import { localEmbedding } from "../memory/embedding";
import type { AgentObservation } from "../cognition/types";

export interface StateCluster {
  id: string;
  centroid: number[];
  memberCount: number;
  label: string;       // auto-generated from most common URL+appState
  domain: string;
}

// In-memory cluster store
const clusters: StateCluster[] = [];
const SIMILARITY_THRESHOLD = 0.85;  // above = same cluster
const LOOP_THRESHOLD = 0.95;        // above = exact same state (loop)

/**
 * Encode an observation into a fixed-dimension state vector.
 * Combines URL, visible text, and app state into a single embedding.
 */
export function encodeObservation(obs: AgentObservation): number[] {
  const parts: string[] = [];

  if (obs.pageUrl) {
    try {
      const url = new URL(obs.pageUrl);
      parts.push(`url:${url.pathname}`);
    } catch (error) {
      logModuleError("state-encoder", "optional", error, "URL parsing in observation encoding");
      parts.push(`url:${obs.pageUrl}`);
    }
  }

  if (obs.appStateGuess) {
    parts.push(`state:${obs.appStateGuess}`);
  }

  // Take key visible text (first 10 lines, truncated)
  const text = (obs.visibleText ?? []).slice(0, 10).join(" ").slice(0, 500);
  if (text) parts.push(`text:${text}`);

  // Include actionable element hints
  if (obs.actionableElements?.length) {
    const selectors = obs.actionableElements.slice(0, 5).map(e => e.selector ?? e.text ?? "").join(" ");
    parts.push(`elements:${selectors}`);
  }

  const combined = parts.join(" | ");

  // Use semantic embedding when available, fallback to local hash
  if (process.env.LLM_EMBEDDING_API_KEY) {
    try {
      // Dynamic import to avoid circular deps
      const { computeEmbeddingSync } = require("../memory/embedding");
      if (typeof computeEmbeddingSync === "function") {
        return computeEmbeddingSync(combined);
      }
    } catch (error) { logModuleError("state-encoder", "optional", error, "semantic embedding sync fallback"); }
  }

  return localEmbedding(combined, 128);
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Check if a state embedding indicates the agent is in a loop
 * (visiting a very similar state it has been in before).
 */
export function detectLoop(
  currentEmbedding: number[],
  recentEmbeddings: number[][]
): { isLoop: boolean; similarity: number; matchIndex: number } {
  let maxSimilarity = 0;
  let matchIndex = -1;

  for (let i = 0; i < recentEmbeddings.length; i++) {
    const sim = cosineSimilarity(currentEmbedding, recentEmbeddings[i]);
    if (sim > maxSimilarity) {
      maxSimilarity = sim;
      matchIndex = i;
    }
  }

  return {
    isLoop: maxSimilarity >= LOOP_THRESHOLD,
    similarity: maxSimilarity,
    matchIndex: maxSimilarity >= LOOP_THRESHOLD ? matchIndex : -1
  };
}

/**
 * Assign a state embedding to a cluster. Creates new cluster if needed.
 */
export function assignCluster(
  embedding: number[],
  label: string,
  domain: string
): StateCluster {
  // Find nearest existing cluster
  let bestCluster: StateCluster | null = null;
  let bestSim = 0;

  for (const cluster of clusters) {
    const sim = cosineSimilarity(embedding, cluster.centroid);
    if (sim > bestSim) {
      bestSim = sim;
      bestCluster = cluster;
    }
  }

  if (bestCluster && bestSim >= SIMILARITY_THRESHOLD) {
    // Update cluster centroid (online mean)
    const n = bestCluster.memberCount;
    for (let i = 0; i < embedding.length; i++) {
      bestCluster.centroid[i] = (bestCluster.centroid[i] * n + embedding[i]) / (n + 1);
    }
    bestCluster.memberCount += 1;
    return bestCluster;
  }

  // Create new cluster
  const newCluster: StateCluster = {
    id: `cluster_${clusters.length}`,
    centroid: [...embedding],
    memberCount: 1,
    label,
    domain
  };
  clusters.push(newCluster);
  return newCluster;
}

/**
 * Check if a state is novel (far from all known clusters).
 */
export function isNovelState(embedding: number[]): boolean {
  if (clusters.length === 0) return true;
  for (const cluster of clusters) {
    if (cosineSimilarity(embedding, cluster.centroid) >= SIMILARITY_THRESHOLD) {
      return false;
    }
  }
  return true;
}

export function getClusters(): StateCluster[] {
  return [...clusters];
}

export function restoreClusters(data: StateCluster[]): void {
  clusters.length = 0;
  clusters.push(...data);
}

export function resetClusters(): void {
  clusters.length = 0;
}
