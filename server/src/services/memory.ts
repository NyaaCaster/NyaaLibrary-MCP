import { db, ensureMemVecTable, getMemVecDim, memVecTableExists, memFtsCjkTableExists } from "../db/index.js";
import { bigram } from "../utils/bigram.js";
import { embedMany, l2Normalize } from "./embedding.js";
import { getEmbeddingSettings } from "./settings.js";
import { config } from "../config.js";
import { entrySchema, MemoryError, validateProfile } from "./memoryProtocol.js";
import { maintenance } from "./memoryMaintenance.js";
import { ensureMemorySpace, vectorBuffer } from "./memorySpace.js";

// ====== 类型 ======

export interface ProfileRow {
  sender_id: string;
  nickname: string;
  profile_json: string; // JSON string
  created_at: string;
  updated_at: string;
}

export interface MemoryHit {
  id: number;
  content: string;
  score: number;
}

// ====== RRF 参数（与 retrieval.ts 保持一致）======
const RRF_K = 60;

// ====== 画像读写 ======

/** 按 sender_id 读取画像，无结果返回 null。 */
export function getProfile(ownerKey: string): ProfileRow | null {
  const row = db
    .prepare("SELECT * FROM profiles WHERE sender_id = ?")
    .get(ownerKey) as ProfileRow | undefined;
  return row ?? null;
}

/**
 * 写画像：字段级 merge 或整条覆盖。
 * - merge_mode="merge"（默认）：合并 profile_json（{...old, ...patch}）→ UPDATE
 * - merge_mode="replace"：整条覆盖 profile_json → UPDATE
 * - 若 sender_id 不存在：INSERT 新行（两种模式等价）
 * - nickname 有值时同步更新
 */
export function upsertProfile(
  ownerKey: string,
  nickname?: string,
  profilePatch?: Record<string, unknown>,
  mergeMode: "merge" | "replace" = "merge",
): ProfileRow {
  if (profilePatch !== undefined) validateProfile(profilePatch);
  if (nickname !== undefined && (typeof nickname !== "string" || nickname.length > 200)) throw new MemoryError("INVALID_NICKNAME");
  const now = new Date().toISOString();
  const existing = db
    .prepare("SELECT profile_json, nickname FROM profiles WHERE sender_id = ?")
    .get(ownerKey) as { profile_json: string; nickname: string } | undefined;

  if (existing) {
    const oldProfile = JSON.parse(existing.profile_json || "{}");
    let merged: string;
    if (mergeMode === "replace") {
      merged = JSON.stringify(profilePatch ?? {});
    } else {
      merged = profilePatch
        ? JSON.stringify({ ...oldProfile, ...profilePatch })
        : existing.profile_json;
    }
    validateProfile(JSON.parse(merged));
    const newNickname =
      nickname !== undefined ? nickname : existing.nickname;

    db.prepare(
      `UPDATE profiles
         SET nickname = ?, profile_json = ?, updated_at = ?, revision = revision + 1
       WHERE sender_id = ?`,
    ).run(newNickname, merged, now, ownerKey);
  } else {
    const merged = JSON.stringify(profilePatch ?? {});
    const newNickname = nickname ?? "";
    db.prepare(
      `INSERT INTO profiles (sender_id, nickname, profile_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(ownerKey, newNickname, merged, now, now);
  }

  return getProfile(ownerKey)!;
}

// Exact normalized duplicates are the only automatic deduplication path.
export function normalizedContent(content: string): string {
  return content.normalize("NFKC").replace(/\s+/gu, " ").trim();
}
export function insertMemory(owner: string, content: string, salience: number, vector: number[]): number {
  const duplicate = (db.prepare("SELECT id,content FROM memory_entries WHERE owner_key=?").all(owner) as {id:number;content:string}[])
    .find(x => normalizedContent(x.content) === normalizedContent(content));
  if (duplicate) return duplicate.id;
  const now = new Date().toISOString();
  const id = Number(db.prepare("INSERT INTO memory_entries(owner_key,content,char_count,salience,last_access,created_at) VALUES(?,?,?,?,?,?)")
    .run(owner, content, content.length, salience, now, now).lastInsertRowid);
  db.prepare("INSERT INTO vec_mem(rowid,embedding) VALUES(?,?)").run(BigInt(id), vectorBuffer(vector, getEmbeddingSettings().dim));
  db.prepare("INSERT INTO mem_fts(rowid,content) VALUES(?,?)").run(id, content);
  db.prepare("INSERT INTO mem_fts_cjk(rowid,content) VALUES(?,?)").run(id, bigram(content));
  return id;
}
export function deleteExactMemory(owner: string, id: number): boolean {
  return db.transaction(() => {
    if (!db.prepare("DELETE FROM memory_entries WHERE owner_key=? AND id=?").run(owner, id).changes) return false;
    if (memVecTableExists()) db.prepare("DELETE FROM vec_mem WHERE rowid=?").run(BigInt(id));
    db.prepare("DELETE FROM mem_fts WHERE rowid=?").run(id);
    db.prepare("DELETE FROM mem_fts_cjk WHERE rowid=?").run(id);
    return true;
  })();
}
export async function writeMemory(owner: string, content: string, salience = 0.5): Promise<{id:number;chunk_count:number}> {
  const entry = entrySchema.parse({content, salience});
  const space = ensureMemorySpace();
  const [vector] = await embedMany([entry.content]);
  vectorBuffer(vector, getEmbeddingSettings().dim);
  return db.transaction(() => {
    if (ensureMemorySpace() !== space) throw new MemoryError("MEMORY_SPACE_CHANGED",409);
    return {id: insertMemory(owner, entry.content, entry.salience, vector), chunk_count:1};
  })();
}
/** Legacy hint-only deletion cannot establish ownership/version evidence. */
export function forgetMemories(_owner: string, _hints: string[]): {deleted:number} {
  throw new MemoryError("UPGRADE_REQUIRED_USE_SNAPSHOT_REMOVALS", 409);
}

// ====== 沉淀检索 ======

/**
 * 混合检索沉淀：dense (vec_mem KNN) + sparse-trigram (mem_fts BM25)
 *   + sparse-cjk (mem_fts_cjk BM25, V2 D5) → RRF 融合 → D6 重排。
 *
 * 所有阶段强制 WHERE owner_key = ?（决策 F4 越权隔离红线）。
 */
export async function searchMemory(
  ownerKey: string,
  query: string,
  topK: number,
): Promise<MemoryHit[]> {
  const q = query.trim();
  if (!q) return [];

  // ---- Dense ranking ----
  const denseRanks = new Map<number, number>();
  if (memVecTableExists()) {
    try {
      const [embedding] = await embedMany([q]);
      if (embedding) {
        const rows = db
          .prepare(
            `WITH knn AS (
               SELECT rowid AS mem_id, distance
               FROM vec_mem
               WHERE embedding MATCH ? AND k = ?
             )
             SELECT knn.mem_id AS id
               FROM knn
               JOIN memory_entries m ON m.id = knn.mem_id
              WHERE m.owner_key = ?
              ORDER BY knn.distance`,
          )
          .all(
            JSON.stringify(embedding),
            config.retrieval.denseTopK,
            ownerKey,
          ) as { id: number }[];
        rows.forEach((r, i) => denseRanks.set(r.id, i + 1));
      }
    } catch (err) {
      console.warn("[memory] dense stage skipped:", (err as Error).message);
    }
  }

  // ---- Sparse ranking (trigram BM25) ----
  const sparseRanks = new Map<number, number>();
  try {
    const rows = db
      .prepare(
        `SELECT f.rowid AS id
           FROM mem_fts f
           JOIN memory_entries m ON m.id = f.rowid
          WHERE m.owner_key = ? AND f.content MATCH ?
          ORDER BY bm25(mem_fts)
          LIMIT ?`,
      )
      .all(ownerKey, q, config.retrieval.sparseTopK) as { id: number }[];
    rows.forEach((r, i) => sparseRanks.set(r.id, i + 1));
  } catch {
    // FTS MATCH can throw on certain query syntax; ignore and rely on dense.
  }

  // ---- Sparse ranking (CJK bigram BM25) — V2 D5 ----
  const cjkRanks = new Map<number, number>();
  if (config.memory.cjkBigramEnabled) {
    try {
      const cjkQuery = bigram(q);
      if (cjkQuery) {
        const rows = db
          .prepare(
            `SELECT f.rowid AS id
               FROM mem_fts_cjk f
               JOIN memory_entries m ON m.id = f.rowid
              WHERE m.owner_key = ? AND f.content MATCH ?
              ORDER BY bm25(mem_fts_cjk)
              LIMIT ?`,
          )
          .all(ownerKey, cjkQuery, config.retrieval.sparseTopK) as { id: number }[];
        rows.forEach((r, i) => cjkRanks.set(r.id, i + 1));
      }
    } catch {
      // CJK channel failure is non-fatal; skip silently.
    }
  }

  // ---- Reciprocal Rank Fusion (3-way) ----
  const fused = new Map<number, number>();
  for (const [id, rank] of denseRanks)
    fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank));
  for (const [id, rank] of sparseRanks)
    fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank));
  for (const [id, rank] of cjkRanks)
    fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank));

  if (fused.size === 0) return [];

  // ---- D6 统一重排（V2）----
  // Fetch salience + timestamps for all fused candidates.
  const fusedIds = [...fused.keys()];
  const metaRows = db
    .prepare(
      `SELECT id, salience, last_access, created_at
         FROM memory_entries
        WHERE id IN (${fusedIds.map(() => "?").join(",")})`,
    )
    .all(...fusedIds) as {
    id: number;
    salience: number;
    last_access: string | null;
    created_at: string;
  }[];
  const metaMap = new Map(metaRows.map((r) => [r.id, r]));

  const nowMs = Date.now();
  const W = config.memory.salienceWeight;
  const HL = config.memory.decayHalflifeDays;
  const SEC_PER_DAY = 86400;

  const scored = fusedIds.map((id) => {
    const rrf = fused.get(id) ?? 0;
    const meta = metaMap.get(id);
    const sal = meta?.salience ?? 0.5;
    const refTime = meta?.last_access ?? meta?.created_at ?? new Date(nowMs).toISOString();
    const ageDays = (nowMs - new Date(refTime).getTime()) / 1000 / SEC_PER_DAY;
    const decay = Math.pow(0.5, ageDays / HL);
    const final = rrf * (1 + W * sal) * decay;
    return { id, final, rrf };
  });

  scored.sort((a, b) => b.final - a.final);
  const top = scored.slice(0, topK);
  if (top.length === 0) return [];

  // ---- D2 last_access 回写（V2，best-effort）----
  try {
    if (maintenance().active) return top.map(({ id, final }) => {
      const row=db.prepare("SELECT id,content FROM memory_entries WHERE id=? AND owner_key=?").get(id,ownerKey) as {id:number;content:string};
      return {...row,score:final};
    });
    const updateLa = db.prepare(
      "UPDATE memory_entries SET last_access = ? WHERE id = ?",
    );
    const nowISO = new Date(nowMs).toISOString();
    const tx = db.transaction(() => {
      for (const { id } of top) updateLa.run(nowISO, id);
    });
    tx();
  } catch (err) {
    console.warn("[memory] last_access writeback skipped:", (err as Error).message);
  }

  const getEntry = db.prepare(
    "SELECT id, content FROM memory_entries WHERE id = ?",
  );
  return top.map(({ id, final }) => {
    const row = getEntry.get(id) as { id: number; content: string };
    return { id: row.id, content: row.content, score: final };
  });
}
