import { db, ensureMemVecTable, getMemVecDim, memVecTableExists } from "../db/index.js";
import { getEmbeddingSettings } from "./settings.js";
import { hash, MemoryError } from "./memoryProtocol.js";

export function configuredSpace(): string {
  const { base_url, model, dim } = getEmbeddingSettings();
  if (!base_url || !model || !Number.isInteger(dim) || dim < 1 || dim > 65536) throw new MemoryError("EMBEDDING_NOT_CONFIGURED", 409);
  const url = new URL(base_url);
  url.username = ""; url.password = ""; url.search = ""; url.hash = "";
  return hash({ endpoint: url.toString().replace(/\/+$/, "").replace(/\/embeddings$/, ""), model, dim, revision: process.env.MEMORY_SPACE_REVISION ?? "" });
}
export function activeSpace(): string | undefined {
  return (db.prepare("SELECT value FROM settings WHERE key='mem_vec_space'").get() as {value: string} | undefined)?.value;
}
export function ensureMemorySpace(): string {
  const space = configuredSpace();
  const { dim } = getEmbeddingSettings();
  if (activeSpace() === space && getMemVecDim() === dim && memVecTableExists()) return space;
  const count = (db.prepare("SELECT count(*) n FROM memory_entries").get() as {n: number}).n;
  const vecCount = memVecTableExists() ? (db.prepare("SELECT count(*) n FROM vec_mem").get() as {n: number}).n : 0;
  if (count || vecCount || activeSpace() || (getMemVecDim() !== null && getMemVecDim() !== dim)) throw new MemoryError("MEMORY_SPACE_MIGRATION_REQUIRED", 409);
  db.transaction(() => {
    ensureMemVecTable(dim);
    db.prepare("INSERT INTO settings(key,value) VALUES('mem_vec_space',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(space);
  })();
  return space;
}
export function vectorBuffer(vector: number[], dim: number): Buffer {
  if (!Array.isArray(vector) || vector.length !== dim || vector.some(x => typeof x !== "number" || !Number.isFinite(x))) throw new MemoryError("INVALID_EMBEDDING", 502);
  const out = Buffer.alloc(dim * 4);
  vector.forEach((v, i) => {
    if (!Number.isFinite(Math.fround(v))) throw new MemoryError("INVALID_EMBEDDING", 502);
    out.writeFloatLE(v, i * 4);
  });
  return out;
}
export function decodeVector(value: unknown, dim: number): number[] {
  if (!Buffer.isBuffer(value) || value.length !== dim * 4) throw new MemoryError("INVALID_STORED_VECTOR", 503);
  const out = Array.from({length: dim}, (_, i) => value.readFloatLE(i * 4));
  if (out.some(x => !Number.isFinite(x))) throw new MemoryError("INVALID_STORED_VECTOR", 503);
  return out;
}
