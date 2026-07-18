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
  enabled: number;
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

// ---- Owner / Memory / Profile types (V2 前端显示改造) ----

export interface OwnerSummary {
  owner_key: string;
  nickname: string;
  memory_count: number;
  has_profile: number; // 0 | 1
}

export interface MemoryEntryRow {
  id: number;
  owner_key: string;
  content: string;
  char_count: number;
  salience: number;
  created_at: string;
}

export interface ProfileRow {
  sender_id: string;
  nickname: string;
  profile_json: string; // JSON string
  created_at: string;
  updated_at: string;
}

// ---- Owner / Memory / Profile API (V2 前端显示改造) ----

export function fetchOwners() {
  return api.get<OwnerSummary[]>("/owners");
}

export function fetchOwnerMemory(ownerKey: string) {
  return api.get<MemoryEntryRow[]>(
    `/owners/${encodeURIComponent(ownerKey)}/memory`,
  );
}

export function createOwnerMemory(ownerKey: string, content: string, salience?: number) {
  return api.post<{ id: number; chunk_count: number }>(
    `/owners/${encodeURIComponent(ownerKey)}/memory`,
    { content, ...(salience !== undefined ? { salience } : {}) },
  );
}

export function deleteOwnerMemory(ownerKey: string, id: number) {
  return api.del<void>(
    `/owners/${encodeURIComponent(ownerKey)}/memory/${id}`,
  );
}

export function fetchOwnerProfile(ownerKey: string) {
  return api.get<ProfileRow>(
    `/owners/${encodeURIComponent(ownerKey)}/profile`,
  );
}

export function updateOwnerProfile(
  ownerKey: string,
  data: { nickname?: string; profile_patch?: Record<string, unknown> },
) {
  return api.put<ProfileRow>(
    `/owners/${encodeURIComponent(ownerKey)}/profile`,
    data,
  );
}

export function deleteOwnerProfile(ownerKey: string) {
  return api.del<void>(
    `/owners/${encodeURIComponent(ownerKey)}/profile`,
  );
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
