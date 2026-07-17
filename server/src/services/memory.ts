import { db, ensureMemVecTable, getMemVecDim, memVecTableExists } from "../db/index.js";
import { embedMany } from "./embedding.js";
import { getEmbeddingSettings } from "./settings.js";
import { config } from "../config.js";

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
 * 写画像：字段级 merge。
 * - 若 sender_id 已存在：合并 profile_json（{...old, ...patch}）→ UPDATE
 * - 若不存在：INSERT 新行
 * - nickname 有值时同步更新
 */
export function upsertProfile(
  ownerKey: string,
  nickname?: string,
  profilePatch?: Record<string, unknown>,
): ProfileRow {
  const now = new Date().toISOString();
  const existing = db
    .prepare("SELECT profile_json, nickname FROM profiles WHERE sender_id = ?")
    .get(ownerKey) as { profile_json: string; nickname: string } | undefined;

  if (existing) {
    const oldProfile = JSON.parse(existing.profile_json || "{}");
    const merged = profilePatch
      ? JSON.stringify({ ...oldProfile, ...profilePatch })
      : existing.profile_json;
    const newNickname =
      nickname !== undefined ? nickname : existing.nickname;

    db.prepare(
      `UPDATE profiles
         SET nickname = ?, profile_json = ?, updated_at = ?
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

// ====== 沉淀写入 ======

/** 写一条记忆沉淀：embed → 事务写 memory_entries + vec_mem + mem_fts。 */
export async function writeMemory(
  ownerKey: string,
  content: string,
  salience: number = 0,
): Promise<{ id: number; chunk_count: number }> {
  const { dim } = getEmbeddingSettings();
  if (!dim || dim <= 0) {
    throw new Error("尚未配置嵌入维度，请先在「嵌入模型设置」中保存并自动获取维度");
  }

  const embeddings = await embedMany([content]);
  if (!embeddings[0] || embeddings[0].length !== dim) {
    throw new Error(`嵌入维度与配置不一致（期望 ${dim}）`);
  }

  ensureMemVecTable(dim);
  if (getMemVecDim() !== dim) {
    throw new Error("向量表维度与当前嵌入维度不匹配");
  }

  const now = new Date().toISOString();
  const insertEntry = db.prepare(
    `INSERT INTO memory_entries (owner_key, content, char_count, salience, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertVec = db.prepare(
    "INSERT INTO vec_mem (rowid, embedding) VALUES (?, ?)",
  );
  const insertFts = db.prepare(
    "INSERT INTO mem_fts (rowid, content) VALUES (?, ?)",
  );

  const tx = db.transaction(() => {
    const info = insertEntry.run(ownerKey, content, content.length, salience, now);
    const id = Number(info.lastInsertRowid);
    insertVec.run(BigInt(id), JSON.stringify(embeddings[0]));
    insertFts.run(id, content);
    return id;
  });

  const id = tx();
  return { id, chunk_count: 1 };
}

// ====== 沉淀检索 ======

/**
 * 混合检索沉淀：dense (vec_mem KNN) + sparse (mem_fts BM25) → RRF 融合。
 * 所有阶段强制 WHERE owner_key = ?（决策 F4 越权隔离红线）。
 * 检索 SQL 与 retrieval.ts 同构，仅表名和过滤键不同。
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

  // ---- Sparse ranking (BM25) ----
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

  // ---- Reciprocal Rank Fusion ----
  const fused = new Map<number, number>();
  for (const [id, rank] of denseRanks)
    fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank));
  for (const [id, rank] of sparseRanks)
    fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank));

  const ranked = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK);
  if (ranked.length === 0) return [];

  const getEntry = db.prepare(
    "SELECT id, content FROM memory_entries WHERE id = ?",
  );
  return ranked.map(([id, score]) => {
    const row = getEntry.get(id) as { id: number; content: string };
    return { id: row.id, content: row.content, score };
  });
}
