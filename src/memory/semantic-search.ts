import { getAllEpisodesWithEmbeddings, type Episode } from "./episode-store";
import { computeEmbedding } from "./embedding";

export interface SemanticMatch {
  episode: Episode;
  similarity: number;
}

/**
 * Find the most similar past episodes to a given goal.
 */
export async function findSimilarEpisodes(
  goal: string,
  topK: number = 5,
  minSimilarity: number = 0.3
): Promise<SemanticMatch[]> {
  const queryEmbedding = await computeEmbedding(goal);
  const episodes = getAllEpisodesWithEmbeddings();

  const scored = episodes
    .map(episode => ({
      episode,
      similarity: cosineSimilarity(queryEmbedding, episode.embedding!)
    }))
    .filter(m => m.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return scored;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Format retrieved episodes as context string for planner.
 */
export function formatEpisodesAsContext(matches: SemanticMatch[]): string {
  if (matches.length === 0) return "";

  return matches
    .map((m, i) => `[Past Experience ${i + 1} (similarity: ${m.similarity.toFixed(2)})] ${m.episode.summary}`)
    .join("\n");
}
