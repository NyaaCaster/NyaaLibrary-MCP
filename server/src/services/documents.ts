import { db, vecTableExists } from "../db/index.js";

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

export function listDocuments(kbId: string): DocumentRow[] {
  return db
    .prepare("SELECT * FROM documents WHERE kb_id = ? ORDER BY uploaded_at DESC")
    .all(kbId) as DocumentRow[];
}

export function getDocument(docId: string): DocumentRow | null {
  return (
    (db.prepare("SELECT * FROM documents WHERE id = ?").get(docId) as
      | DocumentRow
      | undefined) ?? null
  );
}

export function listChunks(docId: string): ChunkRow[] {
  return db
    .prepare("SELECT * FROM chunks WHERE doc_id = ? ORDER BY seq ASC")
    .all(docId) as ChunkRow[];
}

export function getChunk(chunkId: number): ChunkRow | null {
  return (
    (db.prepare("SELECT * FROM chunks WHERE id = ?").get(chunkId) as
      | ChunkRow
      | undefined) ?? null
  );
}

function dropChunkIndexes(chunkIds: number[]): void {
  for (const cid of chunkIds) {
    db.prepare("DELETE FROM chunks_fts WHERE rowid = ?").run(cid);
    if (vecTableExists()) {
      db.prepare("DELETE FROM vec_chunks WHERE rowid = ?").run(BigInt(cid));
    }
  }
}

export function deleteChunk(chunkId: number): boolean {
  const chunk = getChunk(chunkId);
  if (!chunk) return false;
  const tx = db.transaction(() => {
    dropChunkIndexes([chunkId]);
    db.prepare("DELETE FROM chunks WHERE id = ?").run(chunkId);
    db.prepare(
      "UPDATE documents SET chunk_count = chunk_count - 1 WHERE id = ?",
    ).run(chunk.doc_id);
  });
  tx();
  return true;
}

export function deleteDocument(docId: string): boolean {
  const doc = getDocument(docId);
  if (!doc) return false;
  const chunkIds = (
    db.prepare("SELECT id FROM chunks WHERE doc_id = ?").all(docId) as {
      id: number;
    }[]
  ).map((r) => r.id);
  const tx = db.transaction(() => {
    dropChunkIndexes(chunkIds);
    db.prepare("DELETE FROM documents WHERE id = ?").run(docId); // cascades chunks
  });
  tx();
  return true;
}
