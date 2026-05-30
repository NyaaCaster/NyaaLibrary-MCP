import { Router } from "express";
import { z } from "zod";
import { getKnowledgeBase } from "../services/kb.js";
import {
  deleteChunk,
  deleteDocument,
  getChunk,
  getDocument,
  listChunks,
  listDocuments,
} from "../services/documents.js";
import { searchKnowledgeBase } from "../services/retrieval.js";
import { NotImplementedError } from "../services/ingest.js";
import { config } from "../config.js";

// KB-scoped document/chunk/retrieval endpoints, mounted at /api.
export const libraryRouter = Router();

libraryRouter.get("/kb/:kbId/documents", (req, res) => {
  if (!getKnowledgeBase(req.params.kbId)) {
    res.status(404).json({ error: "知识库不存在" });
    return;
  }
  res.json(listDocuments(req.params.kbId));
});

// Upload + ingestion — implemented in M1.
libraryRouter.post("/kb/:kbId/documents", (_req, res) => {
  const err = new NotImplementedError();
  res.status(err.status).json({ error: err.message });
});

const searchSchema = z.object({
  query: z.string().min(1),
  top_k: z.number().int().positive().max(50).optional(),
});

libraryRouter.post("/kb/:kbId/search", async (req, res) => {
  const kb = getKnowledgeBase(req.params.kbId);
  if (!kb) {
    res.status(404).json({ error: "知识库不存在" });
    return;
  }
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "检索内容不能为空" });
    return;
  }
  try {
    const hits = await searchKnowledgeBase(
      kb.id,
      parsed.data.query,
      parsed.data.top_k ?? config.retrieval.topK,
    );
    res.json({ count: hits.length, results: hits });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

libraryRouter.get("/documents/:docId", (req, res) => {
  const doc = getDocument(req.params.docId);
  if (!doc) {
    res.status(404).json({ error: "文档不存在" });
    return;
  }
  res.json(doc);
});

libraryRouter.delete("/documents/:docId", (req, res) => {
  if (!deleteDocument(req.params.docId)) {
    res.status(404).json({ error: "文档不存在" });
    return;
  }
  res.status(204).end();
});

libraryRouter.get("/documents/:docId/chunks", (req, res) => {
  if (!getDocument(req.params.docId)) {
    res.status(404).json({ error: "文档不存在" });
    return;
  }
  res.json(listChunks(req.params.docId));
});

libraryRouter.get("/chunks/:chunkId", (req, res) => {
  const chunk = getChunk(Number(req.params.chunkId));
  if (!chunk) {
    res.status(404).json({ error: "分块不存在" });
    return;
  }
  res.json(chunk);
});

libraryRouter.delete("/chunks/:chunkId", (req, res) => {
  if (!deleteChunk(Number(req.params.chunkId))) {
    res.status(404).json({ error: "分块不存在" });
    return;
  }
  res.status(204).end();
});
