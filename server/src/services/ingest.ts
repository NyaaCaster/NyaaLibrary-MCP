import { randomUUID } from "node:crypto";
import { db, ensureVecTable, getVecDim } from "../db/index.js";
import { extractText, extOf } from "../parsers/index.js";
import { splitIntoChunks } from "./chunk.js";
import { embedMany } from "./embedding.js";
import { getEmbeddingSettings } from "./settings.js";
import type { DocumentRow } from "./documents.js";

export interface IngestOptions {
  kbId: string;
  filename: string;
  buffer: Buffer;
  chunkSize: number;
  chunkOverlap: number;
}

export interface IngestResult {
  document: DocumentRow;
  chunk_count: number;
}

/**
 * Ingest one document end-to-end: parse → chunk → embed → persist.
 * Embedding (network) happens before the DB transaction so the write is
 * all-or-nothing and never leaves a half-indexed document.
 */
export async function ingestDocument(opts: IngestOptions): Promise<IngestResult> {
  const { kbId, filename, buffer, chunkSize, chunkOverlap } = opts;

  const { dim } = getEmbeddingSettings();
  if (!dim || dim <= 0) {
    throw new Error("尚未配置嵌入维度，请先在「嵌入模型设置」中保存并自动获取维度");
  }

  const text = await extractText(filename, buffer);
  const chunks = splitIntoChunks(text, chunkSize, chunkOverlap);
  if (chunks.length === 0) {
    throw new Error("文档解析后无可索引内容（可能为空或无法提取文本）");
  }

  const embeddings = await embedMany(chunks);
  if (embeddings.some((v) => !v || v.length !== dim)) {
    throw new Error(`嵌入维度与配置不一致（期望 ${dim}）`);
  }

  ensureVecTable(dim);
  if (getVecDim() !== dim) {
    throw new Error("向量表维度与当前嵌入维度不匹配");
  }

  const docId = randomUUID();
  const uploadedAt = new Date().toISOString();
  const ext = extOf(filename);
  const sizeBytes = buffer.length;

  const insertDoc = db.prepare(
    `INSERT INTO documents (id, kb_id, name, ext, size_bytes, chunk_count, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertChunk = db.prepare(
    `INSERT INTO chunks (doc_id, kb_id, seq, content, char_count, vector_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertVec = db.prepare(
    "INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)",
  );
  const insertFts = db.prepare(
    "INSERT INTO chunks_fts (rowid, content) VALUES (?, ?)",
  );
  const touchKb = db.prepare(
    "UPDATE knowledge_bases SET updated_at = ? WHERE id = ?",
  );

  const tx = db.transaction(() => {
    insertDoc.run(docId, kbId, filename, ext, sizeBytes, chunks.length, uploadedAt);
    chunks.forEach((content, seq) => {
      const info = insertChunk.run(
        docId,
        kbId,
        seq,
        content,
        content.length,
        randomUUID(),
      );
      const chunkId = Number(info.lastInsertRowid);
      // sqlite-vec requires the rowid bound as a true integer; BigInt forces
      // better-sqlite3 to bind it as INTEGER rather than a float.
      insertVec.run(BigInt(chunkId), JSON.stringify(embeddings[seq]));
      insertFts.run(chunkId, content);
    });
    touchKb.run(uploadedAt, kbId);
  });
  tx();

  const document = db
    .prepare("SELECT * FROM documents WHERE id = ?")
    .get(docId) as DocumentRow;
  return { document, chunk_count: chunks.length };
}
