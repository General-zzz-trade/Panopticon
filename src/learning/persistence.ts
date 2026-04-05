/**
 * Learning Persistence — saves and restores learning state to/from SQLite.
 *
 * Each learning module (Thompson sampling, weight optimizer, prompt evolver,
 * state encoder) keeps state in memory. This module serialises that state
 * to the `learning_state` table so it survives across process restarts.
 */

import { getDb } from "../db/client";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const CREATE_LEARNING_TABLE = `
CREATE TABLE IF NOT EXISTS learning_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

let tableCreated = false;

export function initLearningPersistence(): void {
  if (tableCreated) return;
  getDb().exec(CREATE_LEARNING_TABLE);
  tableCreated = true;
}

// ---------------------------------------------------------------------------
// Generic load / save
// ---------------------------------------------------------------------------

export function saveLearningState(key: string, value: unknown): void {
  initLearningPersistence();
  const json = JSON.stringify(value);
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO learning_state (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                                      updated_at = excluded.updated_at`
    )
    .run(key, json, now);
}

export function loadLearningState<T>(key: string): T | undefined {
  initLearningPersistence();
  const row = getDb()
    .prepare("SELECT value_json FROM learning_state WHERE key = ?")
    .get(key) as { value_json: string } | undefined;
  if (!row) return undefined;
  return JSON.parse(row.value_json) as T;
}

// ---------------------------------------------------------------------------
// Convenience: Thompson Sampling stats
// ---------------------------------------------------------------------------

export function persistThompsonStats(): void {
  try {
    const { getPlannerStats } = require("../planner/thompson-sampling");
    saveLearningState("thompson_stats", getPlannerStats());
  } catch (e) {
    console.warn("[persistence] failed to persist thompson stats:", e);
  }
}

export function restoreThompsonStats(): void {
  try {
    const data = loadLearningState<unknown[]>("thompson_stats");
    if (!data) return;
    const { restoreStats } = require("../planner/thompson-sampling");
    restoreStats(data);
  } catch (e) {
    console.warn("[persistence] failed to restore thompson stats:", e);
  }
}

// ---------------------------------------------------------------------------
// Convenience: Adaptive Weights
// ---------------------------------------------------------------------------

export function persistAdaptiveWeights(): void {
  try {
    const { getAdaptiveWeights } = require("./weight-optimizer");
    saveLearningState("adaptive_weights", getAdaptiveWeights());
  } catch (e) {
    console.warn("[persistence] failed to persist adaptive weights:", e);
  }
}

export function restoreAdaptiveWeights(): void {
  try {
    const data = loadLearningState<unknown>("adaptive_weights");
    if (!data) return;
    const { restoreWeights } = require("./weight-optimizer");
    restoreWeights(data);
  } catch (e) {
    console.warn("[persistence] failed to restore adaptive weights:", e);
  }
}

// ---------------------------------------------------------------------------
// Convenience: Prompt Variants
// ---------------------------------------------------------------------------

export function persistPromptVariants(): void {
  try {
    const { getAllVariants } = require("./prompt-evolver");
    saveLearningState("prompt_variants", getAllVariants());
  } catch (e) {
    console.warn("[persistence] failed to persist prompt variants:", e);
  }
}

export function restorePromptVariants(): void {
  try {
    const data = loadLearningState<Record<string, unknown[]>>("prompt_variants");
    if (!data) return;
    const { restoreVariants } = require("./prompt-evolver");
    restoreVariants(data);
  } catch (e) {
    console.warn("[persistence] failed to restore prompt variants:", e);
  }
}

// ---------------------------------------------------------------------------
// Convenience: State Clusters
// ---------------------------------------------------------------------------

export function persistStateClusters(): void {
  try {
    const { getClusters } = require("../world-model/state-encoder");
    saveLearningState("state_clusters", getClusters());
  } catch (e) {
    console.warn("[persistence] failed to persist state clusters:", e);
  }
}

export function restoreStateClusters(): void {
  try {
    const data = loadLearningState<unknown[]>("state_clusters");
    if (!data) return;
    const { restoreClusters } = require("../world-model/state-encoder");
    restoreClusters(data);
  } catch (e) {
    console.warn("[persistence] failed to restore state clusters:", e);
  }
}

// ---------------------------------------------------------------------------
// Bulk persist / restore
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Convenience: Recovery Skill Library
// ---------------------------------------------------------------------------

export function persistSkillLibrary(): void {
  try {
    const { getSkillLibrary } = require("../cognition/recovery-synthesizer");
    saveLearningState("skill_library", getSkillLibrary());
  } catch (e) {
    console.warn("[persistence] failed to persist skill library:", e);
  }
}

export function restoreSkillLibrary(): void {
  try {
    const data = loadLearningState<unknown[]>("skill_library");
    if (!data) return;
    const { restoreSkillLibrary: restore } = require("../cognition/recovery-synthesizer");
    restore(data);
  } catch (e) {
    console.warn("[persistence] failed to restore skill library:", e);
  }
}

// ---------------------------------------------------------------------------
// Convenience: Causal Graph
// ---------------------------------------------------------------------------

export function persistCausalGraph(): void {
  try {
    const { serializeGraph } = require("../world-model/causal-graph");
    const { getActiveCausalGraph } = require("../world-model/causal-graph-registry");
    const graph = getActiveCausalGraph();
    if (graph && (graph.nodes.size > 0 || graph.edges.size > 0)) {
      // Prune before persisting
      const { pruneGraph } = require("../world-model/causal-graph");
      pruneGraph(graph, 500, 2000);
      const serialized = serializeGraph(graph);
      saveLearningState("causal_graph", serialized);
    }
  } catch (e) {
    console.warn("[persistence] failed to persist causal graph:", e);
  }
}

export function restoreCausalGraph(): void {
  try {
    const data = loadLearningState<string>("causal_graph");
    if (!data) return;
    const { deserializeGraph } = require("../world-model/causal-graph");
    const { setActiveCausalGraph } = require("../world-model/causal-graph-registry");
    const graph = deserializeGraph(data);
    setActiveCausalGraph(graph);
  } catch (e) {
    console.warn("[persistence] failed to restore causal graph:", e);
  }
}

// ---------------------------------------------------------------------------
// Bulk persist / restore
// ---------------------------------------------------------------------------

export function persistAllLearning(): void {
  const fns = [persistThompsonStats, persistAdaptiveWeights, persistPromptVariants, persistStateClusters, persistSkillLibrary, persistCausalGraph];
  for (const fn of fns) {
    try { fn(); } catch (e) { console.warn("[persistence] error in", fn.name, e); }
  }
}

export function restoreAllLearning(): void {
  const fns = [restoreThompsonStats, restoreAdaptiveWeights, restorePromptVariants, restoreStateClusters, restoreSkillLibrary, restoreCausalGraph];
  for (const fn of fns) {
    try { fn(); } catch (e) { console.warn("[persistence] error in", fn.name, e); }
  }
}
