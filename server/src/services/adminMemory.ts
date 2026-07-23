import { db, getMemVecDim, memVecTableExists } from "../db/index.js";
import { getEmbeddingSettings } from "./settings.js";
import {
  getProfile,
  upsertProfile,
  writeMemory,
} from "./memory.js";

// 复用导出（供 routes/owners.ts 使用）
export { getProfile, upsertProfile, writeMemory };

// ====== 类型 ======

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
  last_access: string | null;
  created_at: string;
}

// ====== Owner 聚合 ======

/** 聚合所有 owner：合并 memory_entries 与 profiles，按记忆条数降序。 */
export function listOwners(): OwnerSummary[] {
  return db
    .prepare(
      `SELECT
         COALESCE(m.owner_key, p.sender_id) AS owner_key,
         COALESCE(p.nickname, '')           AS nickname,
         COALESCE(m.cnt, 0)                 AS memory_count,
         CASE WHEN p.sender_id IS NOT NULL THEN 1 ELSE 0 END AS has_profile
       FROM (SELECT owner_key, COUNT(*) AS cnt FROM memory_entries GROUP BY owner_key) m
       FULL OUTER JOIN profiles p ON m.owner_key = p.sender_id
       ORDER BY memory_count DESC`,
    )
    .all() as OwnerSummary[];
}

// ====== 记忆条目列表 ======

/** 列出某 owner 的所有记忆条目（不含向量），按创建时间倒序。 */
export function listMemoryByOwner(ownerKey: string): MemoryEntryRow[] {
  return db
    .prepare(
      `SELECT id, owner_key, content, char_count, salience, last_access, created_at
       FROM memory_entries
       WHERE owner_key = ?
       ORDER BY created_at DESC`,
    )
    .all(ownerKey) as MemoryEntryRow[];
}

// ====== 精确删除记忆 ======

/**
 * 按 id 精确删除一条记忆条目，同时级联清理 vec_mem 与 mem_fts。
 *
 * 越权防护（SSOT §3.3 承重逻辑）：
 * 1. 先删 memory_entries WHERE id=? AND owner_key=?，取 changes
 * 2. changes===0 → 事务内 return false（id 不存在 / owner 不匹配）
 * 3. changes===1 → 才按 rowid 级联删 vec_mem（懒建守卫）+ mem_fts
 */
export function deleteMemoryById(ownerKey: string, id: number): boolean {
  const delEntry = db.prepare(
    "DELETE FROM memory_entries WHERE id = ? AND owner_key = ?",
  );
  const delFts = db.prepare("DELETE FROM mem_fts WHERE rowid = ?");
  const delFtsCjk = db.prepare("DELETE FROM mem_fts_cjk WHERE rowid = ?");

  let delVec: ReturnType<typeof db.prepare> | null = null;
  if (memVecTableExists()) {
    try {
      delVec = db.prepare("DELETE FROM vec_mem WHERE rowid = ?");
    } catch {
      /* vec_mem may not exist yet */
    }
  }

  const tx = db.transaction(() => {
    const entryResult = delEntry.run(id, ownerKey);
    if (entryResult.changes === 0) return false;

    if (delVec) {
      try {
        delVec.run(BigInt(id));
      } catch {
        /* vec_mem 行可能不存在 */
      }
    }
    delFts.run(id);
    delFtsCjk.run(id);
    return true;
  });

  return tx();
}

// ====== 删除画像 ======

/** 删除某 owner 的整条画像，返回是否命中。 */
export function deleteProfile(ownerKey: string): boolean {
  const result = db
    .prepare("DELETE FROM profiles WHERE sender_id = ?")
    .run(ownerKey);
  return result.changes > 0;
}

// ====== 维度一致检查（D1 前置守卫）======

/**
 * 比对当前嵌入配置维度与已建向量表维度 mem_vec_dim。
 * 补充上传前调用，不一致则拒写 —— 绝不静默 DROP 重建 vec_mem。
 */
export function dimensionInSync(): boolean {
  const { dim } = getEmbeddingSettings();
  if (!dim || dim <= 0) return false;
  return dim === getMemVecDim();
}
