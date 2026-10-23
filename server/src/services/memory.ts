import { db, ensureMemVecTable, getMemVecDim, memVecTableExists, memFtsCjkTableExists } from "../db/index.js";
import { bigram } from "../utils/bigram.js";
import { embedMany, embedTexts } from "./embedding.js";
import { getEmbeddingSettings } from "./settings.js";
import { config } from "../config.js";
import { entrySchema, MemoryError, validateProfile } from "./memoryProtocol.js";
import { maintenance } from "./memoryMaintenance.js";
import { ensureMemorySpace, vectorBuffer, decodeVector, activeSpace, configuredSpace } from "./memorySpace.js";

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

// Natural language is always quoted as data, never used as FTS syntax.
export function ftsTerms(query: string, cjk = false): string[] {
  const text = cjk ? bigram(query) : query;
  return [...new Set(text.match(/[\p{L}\p{N}_]+/gu) ?? [])].slice(0, 100);
}
export function ftsExpression(terms: string[]): string {
  return terms.map(x => '"' + x.replace(/"/g, '""') + '"').join(' OR ');
}
type Channel = {status: string; count: number};
export async function searchMemoryDetailed(ownerKey: string, query: string, topK: number) {
  const started = Date.now();
  const q = query.trim();
  const channels: Record<string, Channel> = {};
  const sparse = async (table: string, cjk: boolean) => {
    const ranks = new Map<number, number>();
    const name = cjk ? 'cjk' : 'sparse';
    try {
      const terms = ftsTerms(q, cjk);
      if (!terms.length) { channels[name] = {status:'empty',count:0}; return ranks; }
      const rows = db.prepare(`SELECT f.rowid AS id FROM ${table} f JOIN memory_entries m ON m.id=f.rowid
        WHERE m.owner_key=? AND f.content MATCH ? ORDER BY bm25(${table}) LIMIT ?`)
        .all(ownerKey, ftsExpression(terms), config.retrieval.sparseTopK) as {id:number}[];
      rows.forEach((r,i) => ranks.set(r.id,i+1));
      // Trigram cannot match 1-2 characters. Bound this owner-only fallback.
      if (!cjk && terms.some(x => x.length < 3)) {
        const short = terms.filter(x => x.length < 3).slice(0,20);
        const extra = db.prepare(`SELECT id FROM memory_entries WHERE owner_key=? AND (${short.map(() => "instr(lower(content),?)>0").join(' OR ')}) ORDER BY id LIMIT ?`)
          .all(ownerKey,...short.map(x=>x.toLowerCase()),config.retrieval.sparseTopK) as {id:number}[];
        for (const row of extra) if (!ranks.has(row.id)) ranks.set(row.id,ranks.size+1);
      }
      channels[name] = {status:'ok',count:ranks.size};
    } catch { channels[name] = {status:'failed',count:0}; }
    return ranks;
  };
  const dense = async () => {
    const ranks = new Map<number, number>();
    const deadline = started + 2000;
    try {
      if (!memVecTableExists() || activeSpace() !== configuredSpace()) throw new Error('SPACE');
      const [vector] = await embedTexts([q], Math.max(1,deadline-Date.now()));
      const dim = getEmbeddingSettings().dim;
      vectorBuffer(vector,dim);
      const norm = Math.hypot(...vector);
      if (!norm) throw new Error('ZERO_VECTOR');
      const scores: {id:number;score:number}[] = [];
      const read = db.prepare('SELECT embedding FROM vec_mem WHERE rowid=?');
      let cursor = 0;
      let truncated = false;
      while (true) {
        if (Date.now() >= deadline) { truncated = true; break; }
        const rows = db.prepare('SELECT id FROM memory_entries WHERE owner_key=? AND id>? ORDER BY id LIMIT 128').all(ownerKey,cursor) as {id:number}[];
        if (!rows.length) break;
        for (const row of rows) {
          if (Date.now() >= deadline) { truncated = true; break; }
          const stored = read.get(BigInt(row.id)) as {embedding:Buffer} | undefined;
          if (!stored) throw new Error('MISSING_VECTOR');
          const v = decodeVector(stored.embedding,dim);
          let dot = 0, size = 0;
          for (let i=0;i<dim;i++) { dot+=vector[i]*v[i]; size+=v[i]*v[i]; }
          if (!size) throw new Error('ZERO_VECTOR');
          scores.push({id:row.id,score:dot/(norm*Math.sqrt(size))});
        }
        if (truncated) break;
        cursor = rows[rows.length-1].id;
        await new Promise<void>(resolve=>setImmediate(resolve));
      }
      scores.sort((a,b)=>b.score-a.score || a.id-b.id);
      scores.slice(0,config.retrieval.denseTopK).forEach((r,i)=>ranks.set(r.id,i+1));
      channels.dense = {status:truncated?'budget_truncated':'ok',count:ranks.size};
    } catch { channels.dense = {status:Date.now() >= deadline-20?'timeout':'failed',count:0}; }
    return ranks;
  };
  const [denseRanks,sparseRanks,cjkRanks] = await Promise.all([dense(),sparse('mem_fts',false),
    config.memory.cjkBigramEnabled?sparse('mem_fts_cjk',true):Promise.resolve(new Map<number,number>())]);
  const fused = new Map<number,number>();
  for (const ranks of [denseRanks,sparseRanks,cjkRanks]) for (const [id,rank] of ranks)
    fused.set(id,(fused.get(id)??0)+1/(RRF_K+rank));
  const read = db.prepare('SELECT id,content,salience,last_access,created_at FROM memory_entries WHERE owner_key=? AND id=?');
  const hits = [...fused].map(([id,rrf])=>{
    const row = read.get(ownerKey,id) as {id:number;content:string;salience:number;last_access:string|null;created_at:string};
    const age = Math.max(0,(Date.now()-Date.parse(row.last_access??row.created_at))/86400000);
    const score = rrf*(1+config.memory.salienceWeight*row.salience)*Math.pow(.5,age/config.memory.decayHalflifeDays);
    return {id,content:row.content,score};
  }).sort((a,b)=>b.score-a.score || a.id-b.id).slice(0,topK);
  if (!maintenance().active && hits.length) {
    try {
      db.transaction(()=>{
        const update=db.prepare('UPDATE memory_entries SET last_access=? WHERE id=? AND owner_key=?');
        for (const hit of hits) update.run(new Date().toISOString(),hit.id,ownerKey);
      })();
    } catch { console.warn('[memory] LAST_ACCESS_FAILED'); }
  }
  const degraded = Object.entries(channels).filter(([,v])=>!['ok','empty'].includes(v.status)).map(([k,v])=>`${k}:${v.status}`);
  return {hits,channels,elapsed_ms:Date.now()-started,degraded};
}
export async function searchMemory(ownerKey:string,query:string,topK:number):Promise<MemoryHit[]> {
  return (await searchMemoryDetailed(ownerKey,query,topK)).hits;
}
