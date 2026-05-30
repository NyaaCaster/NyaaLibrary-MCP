import { db, vecTableExists } from "../db/index.js";
import { getKnowledgeBase } from "./kb.js";
import { embedTexts } from "./embedding.js";

export interface SearchHit {
  chunk_id: number;
  doc_id: string;
  document_name: string;
  seq: number;
  content: string;
  char_count: number;
  score: number;
}

const RRF_K = 60;

/**
 * Hybrid retrieval: dense (sqlite-vec KNN) + sparse (FTS5 BM25), fused with
 * Reciprocal Rank Fusion, returning the top `topK` chunks for a knowledge base.
 */
export async function searchKnowledgeBase(
  kbId: string,
  query: string,
  topK: number,
): Promise<SearchHit[]> {
  const kb = getKnowledgeBase(kbId);
  if (!kb) throw new Error("知识库不存在");
  const q = query.trim();
  if (!q) return [];

  // ---- Dense ranking ----
  const denseRanks = new Map<number, number>();
  if (vecTableExists()) {
    try {
      const [embedding] = await embedTexts([q]);
      if (embedding) {
        // sqlite-vec KNN needs an explicit `k = ?` on the vec table; do the
        // KNN in a CTE, then join + filter by kb_id in the outer query.
        const rows = db
          .prepare(
            `WITH knn AS (
               SELECT rowid AS chunk_id, distance
               FROM vec_chunks
               WHERE embedding MATCH ? AND k = ?
             )
             SELECT knn.chunk_id AS chunk_id
               FROM knn
               JOIN chunks c ON c.id = knn.chunk_id
              WHERE c.kb_id = ?
              ORDER BY knn.distance`,
          )
          .all(JSON.stringify(embedding), kb.dense_top_k, kb.id) as {
          chunk_id: number;
        }[];
        rows.forEach((r, i) => denseRanks.set(r.chunk_id, i + 1));
      }
    } catch (err) {
      // Embedding not configured / unreachable → fall back to sparse-only.
      console.warn("[retrieval] dense stage skipped:", (err as Error).message);
    }
  }

  // ---- Sparse ranking (BM25) ----
  const sparseRanks = new Map<number, number>();
  try {
    const rows = db
      .prepare(
        `SELECT f.rowid AS chunk_id
           FROM chunks_fts f
           JOIN chunks c ON c.id = f.rowid
          WHERE c.kb_id = ? AND f.content MATCH ?
          ORDER BY bm25(chunks_fts)
          LIMIT ?`,
      )
      .all(kb.id, q, kb.sparse_top_k) as { chunk_id: number }[];
    rows.forEach((r, i) => sparseRanks.set(r.chunk_id, i + 1));
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

  const getChunk = db.prepare(
    `SELECT c.id AS chunk_id, c.doc_id, c.seq, c.content, c.char_count, d.name AS document_name
       FROM chunks c JOIN documents d ON d.id = c.doc_id
      WHERE c.id = ?`,
  );
  return ranked.map(([chunkId, score]) => {
    const row = getChunk.get(chunkId) as Omit<SearchHit, "score">;
    return { ...row, score };
  });
}
