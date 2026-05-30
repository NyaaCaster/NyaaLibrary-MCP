import { Router } from "express";
import { z } from "zod";
import {
  maskedEmbeddingSettings,
  saveEmbeddingSettings,
} from "../services/settings.js";
import { detectDimension } from "../services/embedding.js";
import { ensureVecTable } from "../db/index.js";

export const embeddingRouter = Router();

embeddingRouter.get("/settings", (_req, res) => {
  res.json(maskedEmbeddingSettings());
});

const saveSchema = z.object({
  base_url: z.string().optional(),
  api_key: z.string().optional(),
  model: z.string().optional(),
  dim: z.number().int().nonnegative().optional(),
});

embeddingRouter.put("/settings", (req, res) => {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "参数无效" });
    return;
  }
  // Only persist api_key when a non-empty value is provided, so the masked
  // round-trip from the UI does not wipe the stored key.
  const patch = { ...parsed.data };
  if (patch.api_key === undefined || patch.api_key === "") delete patch.api_key;
  const saved = saveEmbeddingSettings(patch);
  if (saved.dim > 0) ensureVecTable(saved.dim);
  res.json(maskedEmbeddingSettings());
});

embeddingRouter.post("/detect-dim", async (req, res) => {
  // Allow probing with not-yet-saved credentials.
  const parsed = saveSchema.safeParse(req.body ?? {});
  if (parsed.success && (parsed.data.base_url || parsed.data.model)) {
    const patch = { ...parsed.data };
    if (patch.api_key === undefined || patch.api_key === "")
      delete patch.api_key;
    saveEmbeddingSettings(patch);
  }
  try {
    const dim = await detectDimension();
    saveEmbeddingSettings({ dim });
    ensureVecTable(dim);
    res.json({ dim });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
