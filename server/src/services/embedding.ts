import { getEmbeddingSettings } from "./settings.js";

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
