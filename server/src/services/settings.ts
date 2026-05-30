import { db } from "../db/index.js";
import { config } from "../config.js";

export interface EmbeddingSettings {
  base_url: string;
  api_key: string;
  model: string;
  dim: number;
}

const KEYS = ["embedding_base_url", "embedding_api_key", "embedding_model", "embedding_dim"] as const;

function readSetting(key: string): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

function writeSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

/** Embedding config: persisted in DB, falling back to .env defaults. */
export function getEmbeddingSettings(): EmbeddingSettings {
  return {
    base_url: readSetting("embedding_base_url") ?? config.embedding.baseUrl,
    api_key: readSetting("embedding_api_key") ?? config.embedding.apiKey,
    model: readSetting("embedding_model") ?? config.embedding.model,
    dim: Number(readSetting("embedding_dim") ?? config.embedding.dim) || 0,
  };
}

export function saveEmbeddingSettings(patch: Partial<EmbeddingSettings>): EmbeddingSettings {
  const current = getEmbeddingSettings();
  const merged = { ...current, ...patch };
  writeSetting("embedding_base_url", merged.base_url);
  writeSetting("embedding_api_key", merged.api_key);
  writeSetting("embedding_model", merged.model);
  writeSetting("embedding_dim", String(merged.dim));
  return merged;
}

/** Mask the API key for safe transport to the frontend. */
export function maskedEmbeddingSettings(): Omit<EmbeddingSettings, "api_key"> & {
  api_key_set: boolean;
} {
  const s = getEmbeddingSettings();
  return {
    base_url: s.base_url,
    model: s.model,
    dim: s.dim,
    api_key_set: s.api_key.length > 0,
  };
}

// Reference the compile-time key list so it is not dropped by tooling.
export const SETTING_KEYS = KEYS;
