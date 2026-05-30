import { Router } from "express";
import { config, SUPPORTED_EXTENSIONS } from "../config.js";

export const configRouter = Router();

// Non-secret preset values for the management UI (upload hints, defaults).
configRouter.get("/", (_req, res) => {
  res.json({
    supportedExtensions: SUPPORTED_EXTENSIONS,
    maxFileSizeMb: config.upload.maxFileSizeMb,
    maxUploadCount: config.upload.maxUploadCount,
    chunk: { size: config.chunk.size, overlap: config.chunk.overlap },
    batch: {
      size: config.batch.size,
      concurrency: config.batch.concurrency,
      maxRetries: config.batch.maxRetries,
    },
    retrieval: { topK: config.retrieval.topK },
  });
});
