import { getEmbeddingSettings } from "./settings.js";
import { config } from "../config.js";
import pLimit from "p-limit";

const REQUEST_TIMEOUT_MS = 60_000;

interface EmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

function endpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  // Accept either a bare host or a full ".../v1" base.
  return /\/embeddings$/.test(trimmed)
    ? trimmed
    : `${trimmed}/embeddings`;
}

/** Embed an ordered batch of texts via an OpenAI-compatible /embeddings API. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const { base_url, api_key, model } = getEmbeddingSettings();
  if (!base_url || !model) {
    throw new Error("嵌入模型未配置（缺少 Base URL 或模型名称）");
  }
  const res = await fetch(endpoint(base_url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(api_key ? { Authorization: `Bearer ${api_key}` } : {}),
    },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`嵌入接口返回 HTTP ${res.status}：${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as EmbeddingResponse;
  return json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/** Probe the configured model to discover its embedding dimension. */
export async function detectDimension(): Promise<number> {
  const [vec] = await embedTexts(["dimension probe"]);
  if (!vec || vec.length === 0) {
    throw new Error("无法从嵌入接口响应中解析维度");
  }
  return vec.length;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function embedBatchWithRetry(
  texts: string[],
  maxRetries: number,
): Promise<number[][]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await embedTexts(texts);
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Embed many texts: split into BATCH_SIZE batches, run up to CONCURRENCY_LIMIT
 * batches in parallel, retry each batch up to MAX_RETRIES. Order is preserved.
 */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { size, concurrency, maxRetries } = config.batch;
  const limit = pLimit(Math.max(1, concurrency));

  const batches: { start: number; texts: string[] }[] = [];
  for (let i = 0; i < texts.length; i += Math.max(1, size)) {
    batches.push({ start: i, texts: texts.slice(i, i + Math.max(1, size)) });
  }

  const result = new Array<number[]>(texts.length);
  await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        const vectors = await embedBatchWithRetry(batch.texts, maxRetries);
        vectors.forEach((v, j) => {
          result[batch.start + j] = v;
        });
      }),
    ),
  );
  return result;
}
