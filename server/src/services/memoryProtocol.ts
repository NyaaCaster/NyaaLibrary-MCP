import { z } from "zod";
import { createHash } from "node:crypto";

export class MemoryError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export const hash = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
export const forbidden = new Set(["__proto__", "prototype", "constructor"]);
export function validateProfile(value: unknown, depth = 0): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MemoryError("INVALID_PROFILE");
  function walk(v: unknown, d: number): void {
    if (d > 8) throw new MemoryError("PROFILE_DEPTH_EXCEEDED");
    if (v === null || (typeof v === "number" && !Number.isFinite(v))) throw new MemoryError("INVALID_PROFILE_VALUE");
    if (Array.isArray(v)) { for (const x of v) walk(x, d + 1); }
    else if (typeof v === "object") for (const [k, x] of Object.entries(v as object)) {
      if (forbidden.has(k)) throw new MemoryError("UNSAFE_PROFILE_KEY");
      walk(x, d + 1);
    }
  }
  walk(value, depth);
  if (Buffer.byteLength(JSON.stringify(value)) > 32768) throw new MemoryError("PROFILE_TOO_LARGE");
}
export function pointer(path: string): string[] {
  if (!path.startsWith("/") || /~(?![01])/.test(path)) throw new MemoryError("INVALID_DELETE_PATH");
  const parts = path.slice(1).split("/").map(p => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (parts.some(p => forbidden.has(p)) || parts.length > 8) throw new MemoryError("INVALID_DELETE_PATH");
  return parts;
}
export function mergeProfile(old: Record<string, unknown>, patch: Record<string, unknown>, deletes: string[]): Record<string, unknown> {
  validateProfile(patch);
  function merge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
    const out = structuredClone(a);
    for (const [k, v] of Object.entries(b)) {
      out[k] = v && typeof v === "object" && !Array.isArray(v)
        ? merge(out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) ? out[k] as Record<string, unknown> : {}, v as Record<string, unknown>) : structuredClone(v);
    }
    return out;
  }
  const out = merge(old, patch);
  for (const path of deletes) {
    const parts = pointer(path);
    let p: unknown = patch;
    for (const key of parts) {
      if (p !== undefined && (p === null || typeof p !== "object" || Array.isArray(p))) throw new MemoryError("PATCH_DELETE_CONFLICT");
      p = p && typeof p === "object" && Object.hasOwn(p, key) ? (p as Record<string, unknown>)[key] : undefined;
    }
    if (p !== undefined) throw new MemoryError("PATCH_DELETE_CONFLICT");
    let target: unknown = out;
    for (const key of parts.slice(0, -1)) target = target && typeof target === "object" ? (target as Record<string, unknown>)[key] : undefined;
    if (Array.isArray(target)) throw new MemoryError("ARRAY_DELETE_UNSUPPORTED");
    if (target && typeof target === "object") delete (target as Record<string, unknown>)[parts.at(-1)!];
  }
  validateProfile(out);
  return out;
}
export const entrySchema = z.object({content: z.string().trim().min(1).max(4000), salience: z.number().finite().min(0).max(1).default(0.5)}).strict();
export const searchSchema = z.object({query: z.string().trim().min(1).max(2000), top_k: z.number().int().min(1).max(50).optional()}).strict();
const sourceSchema = z.object({id: z.string().min(1).max(200), author: z.string().min(1).max(200), role: z.literal("user"), content: z.string().min(1).max(32768)}).strict();
export const snapshotSchema = z.object({query: z.string().trim().min(1).max(2000), sources: z.array(sourceSchema).max(200)}).strict();
export const batchSchema = z.object({
  operation_id: z.string().min(1).max(200), snapshot_id: z.string().min(1).max(200), parent_id: z.string().max(200).optional(),
  nickname: z.string().max(200).optional(), profile_patch: z.record(z.unknown()).default({}),
  delete_paths: z.array(z.string().max(1000)).max(50).default([]), memory_entries: z.array(entrySchema).max(50).default([]),
  removals: z.array(z.object({id: z.number().int().positive(), version: z.number().int().positive(), source_id: z.string().min(1).max(200), evidence: z.string().min(1).max(4000), reason: z.enum(["correction", "retraction"])}).strict()).max(50).default([]),
}).strict();
export type BatchRequest = z.infer<typeof batchSchema>;
