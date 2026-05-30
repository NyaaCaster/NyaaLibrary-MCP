import { clearSession, getToken } from "./auth";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** When false, a 401 will not clear the session / redirect (e.g. login). */
  auth?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth) {
    clearSession();
    if (window.location.pathname !== "/login") window.location.assign("/login");
    throw new ApiError(401, "登录已过期，请重新登录");
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error ?? `请求失败 (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown, auth = true) =>
    request<T>(p, { method: "POST", body, auth }),
  put: <T>(p: string, body?: unknown) => request<T>(p, { method: "PUT", body }),
  patch: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "PATCH", body }),
  del: <T>(p: string) => request<T>(p, { method: "DELETE" }),
};

// ---- Shared API types ----
export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  chunk_size: number;
  chunk_overlap: number;
  dense_top_k: number;
  sparse_top_k: number;
  created_at: string;
  updated_at: string;
  document_count: number;
  chunk_count: number;
}

export interface DocumentRow {
  id: string;
  kb_id: string;
  name: string;
  ext: string;
  size_bytes: number;
  chunk_count: number;
  uploaded_at: string;
}

export interface ChunkRow {
  id: number;
  doc_id: string;
  kb_id: string;
  seq: number;
  content: string;
  char_count: number;
  vector_id: string;
}

export interface AppConfig {
  supportedExtensions: string[];
  maxFileSizeMb: number;
  maxUploadCount: number;
  chunk: { size: number; overlap: number };
  batch: { size: number; concurrency: number; maxRetries: number };
  retrieval: { topK: number };
}

/** Multipart upload (does not set Content-Type so the browser adds boundary). */
export async function uploadDocuments(
  kbId: string,
  files: File[],
  opts: { chunkSize?: number; chunkOverlap?: number } = {},
): Promise<{ results: { filename: string; ok: boolean; error?: string; chunk_count?: number }[] }> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  if (opts.chunkSize != null) form.append("chunk_size", String(opts.chunkSize));
  if (opts.chunkOverlap != null)
    form.append("chunk_overlap", String(opts.chunkOverlap));

  const token = getToken();
  const res = await fetch(`/api/kb/${kbId}/documents`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 400) {
    throw new ApiError(res.status, (data as { error?: string }).error ?? "上传失败");
  }
  return data as { results: { filename: string; ok: boolean; error?: string; chunk_count?: number }[] };
}
