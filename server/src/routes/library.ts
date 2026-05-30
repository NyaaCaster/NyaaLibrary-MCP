import { Router } from "express";
import multer, { MulterError } from "multer";
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
import { ingestDocument } from "../services/ingest.js";
import { isSupported } from "../parsers/index.js";
import { config, SUPPORTED_EXTENSIONS } from "../config.js";

// KB-scoped document/chunk/retrieval endpoints, mounted at /api.
export const libraryRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileSizeMb * 1024 * 1024,
    files: config.upload.maxUploadCount,
  },
  fileFilter: (_req, file, cb) => {
    // Some clients send non-ASCII filenames as latin1; decode to UTF-8.
    file.originalname = Buffer.from(file.originalname, "latin1").toString("utf8");
    cb(null, isSupported(file.originalname));
  },
});

libraryRouter.get("/kb/:kbId/documents", (req, res) => {
  if (!getKnowledgeBase(req.params.kbId)) {
    res.status(404).json({ error: "知识库不存在" });
    return;
  }
  res.json(listDocuments(req.params.kbId));
});

// Upload + ingest one or more documents (multipart field "files").
libraryRouter.post(
  "/kb/:kbId/documents",
  (req, res, next) => {
    upload.array("files", config.upload.maxUploadCount)(req, res, (err) => {
      if (err instanceof MulterError) {
        const msg =
          err.code === "LIMIT_FILE_SIZE"
            ? `单个文件超过上限 ${config.upload.maxFileSizeMb}MB`
            : err.code === "LIMIT_FILE_COUNT"
              ? `单次最多上传 ${config.upload.maxUploadCount} 个文件`
              : err.message;
        res.status(400).json({ error: msg });
        return;
      }
      if (err) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    const kb = getKnowledgeBase(req.params.kbId);
    if (!kb) {
      res.status(404).json({ error: "知识库不存在" });
      return;
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({
        error: `未收到有效文件（支持的格式：${SUPPORTED_EXTENSIONS.join(", ")}）`,
      });
      return;
    }

    const results = [];
    // Optional per-upload chunk overrides (multipart text fields); fall back
    // to the knowledge base's configured defaults.
    const parseField = (v: unknown, fallback: number): number => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
    };
    const body = req.body as Record<string, unknown>;
    const chunkSize = parseField(body.chunk_size, kb.chunk_size);
    const chunkOverlap = Math.min(
      parseField(body.chunk_overlap, kb.chunk_overlap),
      chunkSize - 1,
    );

    for (const file of files) {
      try {
        const { document, chunk_count } = await ingestDocument({
          kbId: kb.id,
          filename: file.originalname,
          buffer: file.buffer,
          chunkSize,
          chunkOverlap,
        });
        results.push({ filename: file.originalname, ok: true, document, chunk_count });
      } catch (err) {
        results.push({
          filename: file.originalname,
          ok: false,
          error: (err as Error).message,
        });
      }
    }
    const anyOk = results.some((r) => r.ok);
    res.status(anyOk ? 201 : 400).json({ results });
  },
);

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
