import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { config } from "../config.js";

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
}

export interface KnowledgeBaseWithStats extends KnowledgeBase {
  document_count: number;
  chunk_count: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

const statsSelect = `
  SELECT kb.*,
    (SELECT COUNT(*) FROM documents d WHERE d.kb_id = kb.id) AS document_count,
    (SELECT COUNT(*) FROM chunks c WHERE c.kb_id = kb.id) AS chunk_count
  FROM knowledge_bases kb
`;

export function listKnowledgeBases(): KnowledgeBaseWithStats[] {
  return db
    .prepare(`${statsSelect} ORDER BY kb.created_at DESC`)
    .all() as KnowledgeBaseWithStats[];
}

export function getKnowledgeBase(id: string): KnowledgeBaseWithStats | null {
  return (
    (db
      .prepare(`${statsSelect} WHERE kb.id = ?`)
      .get(id) as KnowledgeBaseWithStats | undefined) ?? null
  );
}

/** Resolve a knowledge base by id first, then by exact name. */
export function resolveKnowledgeBase(
  ref: string,
): KnowledgeBaseWithStats | null {
  const byId = getKnowledgeBase(ref);
  if (byId) return byId;
  const byName = db
    .prepare(`${statsSelect} WHERE kb.name = ?`)
    .get(ref) as KnowledgeBaseWithStats | undefined;
  return byName ?? null;
}

export function createKnowledgeBase(
  name: string,
  description = "",
): KnowledgeBaseWithStats {
  const id = randomUUID();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO knowledge_bases
       (id, name, description, chunk_size, chunk_overlap, dense_top_k, sparse_top_k, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    description,
    config.chunk.size,
    config.chunk.overlap,
    config.retrieval.denseTopK,
    config.retrieval.sparseTopK,
    ts,
    ts,
  );
  return getKnowledgeBase(id)!;
}

export function updateKnowledgeBase(
  id: string,
  patch: Partial<
    Pick<
      KnowledgeBase,
      | "name"
      | "description"
      | "chunk_size"
      | "chunk_overlap"
      | "dense_top_k"
      | "sparse_top_k"
    >
  >,
): KnowledgeBaseWithStats | null {
  const existing = getKnowledgeBase(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch, updated_at: nowIso() };
  db.prepare(
    `UPDATE knowledge_bases SET
       name = ?, description = ?, chunk_size = ?, chunk_overlap = ?,
       dense_top_k = ?, sparse_top_k = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    merged.name,
    merged.description,
    merged.chunk_size,
    merged.chunk_overlap,
    merged.dense_top_k,
    merged.sparse_top_k,
    merged.updated_at,
    id,
  );
  return getKnowledgeBase(id);
}

export function deleteKnowledgeBase(id: string): boolean {
  // Cascade removes documents + chunks; mirror that into the vec/fts indexes.
  const chunkIds = db
    .prepare("SELECT id FROM chunks WHERE kb_id = ?")
    .all(id) as { id: number }[];
  const tx = db.transaction(() => {
    for (const { id: cid } of chunkIds) {
      db.prepare("DELETE FROM chunks_fts WHERE rowid = ?").run(cid);
      try {
        db.prepare("DELETE FROM vec_chunks WHERE rowid = ?").run(cid);
      } catch {
        /* vec table may not exist yet */
      }
    }
    db.prepare("DELETE FROM knowledge_bases WHERE id = ?").run(id);
  });
  const before = db
    .prepare("SELECT COUNT(*) AS n FROM knowledge_bases WHERE id = ?")
    .get(id) as { n: number };
  if (before.n === 0) return false;
  tx();
  return true;
}
