import { config } from "../config.js";

export interface EmbeddingSettings {
  base_url: string;
  api_key: string;
  model: string;
  dim: number;
}

/** Embedding config: reads from .env only (no DB backing). */
export function getEmbeddingSettings(): EmbeddingSettings {
  return {
    base_url: config.embedding.baseUrl,
    api_key: config.embedding.apiKey,
    model: config.embedding.model,
    dim: config.embedding.dim,
  };
}
