import { logModuleError } from "../core/module-logger";
import { readProviderConfig } from "../llm/provider";

export interface EmbeddingResult {
  vector: number[];
  model: string;
}

/**
 * Compute embedding for text. Uses LLM embedding API if configured,
 * otherwise falls back to local bag-of-words hashing.
 */
export async function computeEmbedding(text: string): Promise<number[]> {
  const config = readProviderConfig("LLM_EMBEDDING", { maxTokens: 0 });

  if (config.provider && config.apiKey) {
    try {
      return await fetchRemoteEmbedding(config, text);
    } catch (error) {
      logModuleError("embedding", "optional", error, "remote embedding API call");
    }
  }

  return localEmbedding(text);
}

async function fetchRemoteEmbedding(
  config: { provider: string; apiKey?: string; baseUrl?: string; model: string },
  text: string
): Promise<number[]> {
  const baseUrl = config.provider === "anthropic"
    ? "https://api.anthropic.com"
    : (config.baseUrl ?? "https://api.openai.com");

  const url = `${baseUrl.replace(/\/+$/, "")}/v1/embeddings`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
      ...(config.provider === "anthropic" ? { "x-api-key": config.apiKey ?? "", "anthropic-version": "2023-06-01" } : {})
    },
    body: JSON.stringify({
      model: config.model || "text-embedding-3-small",
      input: text.slice(0, 8000)
    })
  });

  if (!response.ok) throw new Error(`Embedding API ${response.status}`);
  const body = await response.json() as { data?: Array<{ embedding?: number[] }> };
  const vector = body.data?.[0]?.embedding;
  if (!vector) throw new Error("No embedding in response");
  return vector;
}

/**
 * Local fallback: deterministic bag-of-words hash embedding.
 * Not great for semantics, but works for basic similarity without an API.
 */
export function localEmbedding(text: string, dimensions: number = 128): number[] {
  const tokens = text.toLowerCase().split(/\W+/).filter(t => t.length > 2);
  const vector = new Float64Array(dimensions);

  for (const token of tokens) {
    const hash = simpleHash(token);
    const idx = Math.abs(hash) % dimensions;
    vector[idx] += hash > 0 ? 1 : -1;
  }

  // L2 normalize
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) vector[i] /= norm;
  }

  return Array.from(vector);
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
