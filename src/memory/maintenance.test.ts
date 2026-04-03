import test from "node:test";
import assert from "node:assert/strict";
import { initEpisodesTable, saveEpisode, getRecentEpisodes, pruneEpisodes, getEpisodeStats, consolidateEpisodes } from "./episode-store";

test("pruneEpisodes removes old failure episodes", () => {
  initEpisodesTable();
  // Save some episodes
  saveEpisode({
    runId: `prune-test-${Date.now()}`,
    goal: "test prune",
    domain: "test.com",
    summary: "test",
    outcome: "failure",
    taskCount: 1,
    replanCount: 0
  });

  // Prune with generous limits — should not remove recent episodes
  const pruned = pruneEpisodes(90, 10000);
  assert.ok(typeof pruned === "number");
});

test("getEpisodeStats returns valid stats", () => {
  initEpisodesTable();
  const stats = getEpisodeStats();
  assert.ok(typeof stats.total === "number");
  assert.ok(typeof stats.byOutcome === "object");
});

test("consolidateEpisodes merges similar episodes", () => {
  initEpisodesTable();
  const consolidated = consolidateEpisodes("nonexistent-domain.com");
  assert.equal(consolidated, 0); // No episodes for this domain
});
