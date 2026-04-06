/**
 * Vector Store — persistent vector embedding storage backed by SQLite,
 * with cosine-similarity search and optional metadata filtering.
 */

import { getDb } from "../db/client";
import { cosineSimilarity } from "./semantic-search";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const CREATE_VECTOR_EMBEDDINGS_TABLE = `
  CREATE TABLE IF NOT EXISTS vector_embeddings (
    id TEXT PRIMARY KEY,
    embedding_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

/**
 * Initialize the vector_embeddings table. Call once at startup.
 */
export function initVectorStore(): void {
  const db = getDb();
  db.exec(CREATE_VECTOR_EMBEDDINGS_TABLE);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VectorEntry {
  id: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface VectorSearchResult {
  id: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

export interface VectorStoreStats {
  count: number;
  dimensions: number | null;
  avgSimilarityToMean: number | null;
}

// ---------------------------------------------------------------------------
// VectorStore class
// ---------------------------------------------------------------------------

export class VectorStore {
  private tableName = "vector_embeddings";

  constructor() {
    initVectorStore();
  }

  /**
   * Add a vector with metadata.
   */
  add(id: string, embedding: number[], metadata: Record<string, unknown> = {}): void {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO ${this.tableName} (id, embedding_json, metadata_json, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `);
    stmt.run(id, JSON.stringify(embedding), JSON.stringify(metadata));
  }

  /**
   * Search for the topK most similar vectors, with optional metadata filter.
   * The filter is a partial object — every key/value must match in the stored metadata.
   */
  search(
    queryEmbedding: number[],
    topK: number = 10,
    filter?: Record<string, unknown>
  ): VectorSearchResult[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, embedding_json, metadata_json FROM ${this.tableName}
    `).all() as Array<{ id: string; embedding_json: string; metadata_json: string }>;

    const scored: VectorSearchResult[] = [];

    for (const row of rows) {
      const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;

      // Apply metadata filter
      if (filter && !matchesFilter(metadata, filter)) {
        continue;
      }

      const embedding = JSON.parse(row.embedding_json) as number[];
      const similarity = cosineSimilarity(queryEmbedding, embedding);

      scored.push({ id: row.id, similarity, metadata });
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, topK);
  }

  /**
   * Remove a vector by id.
   */
  remove(id: string): boolean {
    const db = getDb();
    const result = db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  /**
   * Get stats about the store: count, dimensions, avg similarity to mean vector.
   */
  stats(): VectorStoreStats {
    const db = getDb();
    const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM ${this.tableName}`).get() as { cnt: number };
    const count = countRow.cnt;

    if (count === 0) {
      return { count: 0, dimensions: null, avgSimilarityToMean: null };
    }

    // Get dimensions from first entry
    const firstRow = db.prepare(`SELECT embedding_json FROM ${this.tableName} LIMIT 1`).get() as { embedding_json: string };
    const firstEmbedding = JSON.parse(firstRow.embedding_json) as number[];
    const dimensions = firstEmbedding.length;

    // Compute mean vector and average similarity
    const allRows = db.prepare(`SELECT embedding_json FROM ${this.tableName}`).all() as Array<{ embedding_json: string }>;
    const allEmbeddings = allRows.map((r) => JSON.parse(r.embedding_json) as number[]);

    const mean = new Float64Array(dimensions);
    for (const emb of allEmbeddings) {
      for (let i = 0; i < dimensions; i++) {
        mean[i] += emb[i];
      }
    }
    for (let i = 0; i < dimensions; i++) {
      mean[i] /= count;
    }

    const meanArr = Array.from(mean);
    let totalSim = 0;
    for (const emb of allEmbeddings) {
      totalSim += cosineSimilarity(meanArr, emb);
    }

    return {
      count,
      dimensions,
      avgSimilarityToMean: totalSim / count,
    };
  }

  /**
   * Get a single entry by id.
   */
  get(id: string): VectorEntry | null {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`).get(id) as
      | { id: string; embedding_json: string; metadata_json: string; created_at: string }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      embedding: JSON.parse(row.embedding_json),
      metadata: JSON.parse(row.metadata_json),
      createdAt: row.created_at,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchesFilter(
  metadata: Record<string, unknown>,
  filter: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key] !== value) return false;
  }
  return true;
}
