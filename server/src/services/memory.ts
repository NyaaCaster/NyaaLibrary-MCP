import { db, ensureMemVecTable, getMemVecDim, memVecTableExists, memFtsCjkTableExists } from "../db/index.js";
import { bigram } from "../utils/bigram.js";
import { embedMany, l2Normalize } from "./embedding.js";
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

/** 写一条记忆沉淀：embed → 事务写 memory_entries + vec_mem + mem_fts + mem_fts_cjk。 */
export async function writeMemory(
  ownerKey: string,
  content: string,
  salience: number = 0.5,
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

  // salience clamp：非数值/NaN → 落 0.5；否则 clamp [0, 1]（SSOT D1）
  const clampedSalience =
    typeof salience === "number" && !Number.isNaN(salience)
      ? Math.min(1, Math.max(0, salience))
      : 0.5;

  // ---- 去重检测（D3, SSOT P2）----
  // 同 owner 域内 vec KNN → 归一化余弦 ≥ 阈值则判定为同一事实，走 D4 合并。
  let mergeTargetId: number | null = null;
  if (config.memory.dedupEnabled && memVecTableExists()) {
    try {
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
            ORDER BY knn.distance
            LIMIT 1`,
        )
        .all(
          JSON.stringify(embeddings[0]),
          config.retrieval.denseTopK,
          ownerKey,
        ) as { id: number }[];

      if (rows.length > 0) {
        const candRow = db
          .prepare("SELECT embedding FROM vec_mem WHERE rowid = ?")
          .get(rows[0].id) as { embedding: string } | undefined;
        if (candRow) {
          const vNew = l2Normalize([...embeddings[0]]);
          const vCand = l2Normalize(JSON.parse(candRow.embedding) as number[]);
          let sim = 0;
          for (let i = 0; i < vNew.length; i++) sim += vNew[i] * vCand[i];
          if (sim >= config.memory.dedupSimThreshold) {
            mergeTargetId = rows[0].id;
          }
        }
      }
    } catch (err) {
      console.warn("[memory] dedup check skipped:", (err as Error).message);
    }
  }

  const now = new Date().toISOString();
  const cjkContent = bigram(content);

  // D4 冲突消解：合并到已有条目（SSOT D4）
  if (mergeTargetId !== null) {
    const updateEntry = db.prepare(
      `UPDATE memory_entries
          SET content = ?, char_count = ?, salience = MAX(salience, ?),
              last_access = ?
        WHERE id = ?`,
    );
    const syncVec = db.prepare("DELETE FROM vec_mem WHERE rowid = ?");
    const syncVecIns = db.prepare(
      "INSERT INTO vec_mem (rowid, embedding) VALUES (?, ?)",
    );
    const syncFts = db.prepare("DELETE FROM mem_fts WHERE rowid = ?");
    const syncFtsIns = db.prepare(
      "INSERT INTO mem_fts (rowid, content) VALUES (?, ?)",
    );
    const syncFtsCjk = db.prepare("DELETE FROM mem_fts_cjk WHERE rowid = ?");
    const syncFtsCjkIns = db.prepare(
      "INSERT INTO mem_fts_cjk (rowid, content) VALUES (?, ?)",
    );

    const tx = db.transaction(() => {
      updateEntry.run(
        content,
        content.length,
        clampedSalience,
        now,
        mergeTargetId,
      );
      const bigId = BigInt(mergeTargetId!);
      syncVec.run(bigId);
      syncVecIns.run(bigId, JSON.stringify(embeddings[0]));
      syncFts.run(mergeTargetId!);
      syncFtsIns.run(mergeTargetId!, content);
      syncFtsCjk.run(mergeTargetId!);
      syncFtsCjkIns.run(mergeTargetId!, cjkContent);
      return mergeTargetId!;
    });

    const id = tx();
    return { id, chunk_count: 1 };
  }

  // 原 append 路径（无候选 / 去重未命中）
  const insertEntry = db.prepare(
    `INSERT INTO memory_entries (owner_key, content, char_count, salience, last_access, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertVec = db.prepare(
    "INSERT INTO vec_mem (rowid, embedding) VALUES (?, ?)",
  );
  const insertFts = db.prepare(
    "INSERT INTO mem_fts (rowid, content) VALUES (?, ?)",
  );
  const insertFtsCjk = db.prepare(
    "INSERT INTO mem_fts_cjk (rowid, content) VALUES (?, ?)",
  );

  const tx = db.transaction(() => {
    const info = insertEntry.run(
      ownerKey,
      content,
      content.length,
      clampedSalience,
      now,
      now,
    );
    const id = Number(info.lastInsertRowid);
    insertVec.run(BigInt(id), JSON.stringify(embeddings[0]));
    insertFts.run(id, content);
    insertFtsCjk.run(id, cjkContent);
    return id;
  });

  const id = tx();
  return { id, chunk_count: 1 };
}

// ====== 遗忘（P7 记忆写入策略）======

/**
 * 按 hint 字符串检索并删除 owner 的匹配记忆条目。
 * 每个 hint 在 mem_fts 中搜索，删除匹配的 memory_entries + vec_mem + mem_fts 行。
 * 未匹配到任何条目时返回 {deleted: 0}，不报错。
 */
export function forgetMemories(
  ownerKey: string,
  hints: string[],
): { deleted: number } {
  const delEntry = db.prepare("DELETE FROM memory_entries WHERE id = ?");
  const delFts = db.prepare("DELETE FROM mem_fts WHERE rowid = ?");
  const delFtsCjk = db.prepare("DELETE FROM mem_fts_cjk WHERE rowid = ?");

  // vec_mem is lazily created — only prepare the delete if the table exists
  let delVec: ReturnType<typeof db.prepare> | null = null;
  if (memVecTableExists()) {
    try {
      delVec = db.prepare("DELETE FROM vec_mem WHERE rowid = ?");
    } catch { /* vec_mem may not exist yet */ }
  }

  const idsToDelete = new Set<number>();

  for (const hint of hints) {
    if (!hint.trim()) continue;
    try {
      const rows = db
        .prepare(
          `SELECT f.rowid AS id
             FROM mem_fts f
             JOIN memory_entries m ON m.id = f.rowid
            WHERE m.owner_key = ? AND f.content MATCH ?
            LIMIT 20`,
        )
        .all(ownerKey, hint.trim()) as { id: number }[];
      for (const r of rows) idsToDelete.add(r.id);
    } catch {
      // FTS MATCH 对某些 hint 语法可能抛出异常；跳过该 hint 继续。
    }
  }

  if (idsToDelete.size === 0) return { deleted: 0 };

  const tx = db.transaction(() => {
    let deleted = 0;
    for (const id of idsToDelete) {
      const bigId = BigInt(id);
      delEntry.run(id);
      if (delVec) {
        try { delVec.run(bigId); } catch { /* vec_mem 行可能不存在 */ }
      }
      delFts.run(id);
      delFtsCjk.run(id);
      deleted++;
    }
    return deleted;
  });

  const deleted = tx();
  return { deleted };
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
