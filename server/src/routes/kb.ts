import { Router } from "express";
import { z } from "zod";
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  getKnowledgeBase,
  listKnowledgeBases,
  updateKnowledgeBase,
} from "../services/kb.js";

export const kbRouter = Router();

kbRouter.get("/", (_req, res) => {
  res.json(listKnowledgeBases());
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

kbRouter.post("/", (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "名称不能为空" });
    return;
  }
  res
    .status(201)
    .json(createKnowledgeBase(parsed.data.name, parsed.data.description ?? ""));
});

kbRouter.get("/:id", (req, res) => {
  const kb = getKnowledgeBase(req.params.id);
  if (!kb) {
    res.status(404).json({ error: "知识库不存在" });
    return;
  }
  res.json(kb);
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  chunk_size: z.number().int().positive().optional(),
  chunk_overlap: z.number().int().nonnegative().optional(),
  dense_top_k: z.number().int().positive().optional(),
  sparse_top_k: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
});

kbRouter.patch("/:id", (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "参数无效" });
    return;
  }
  const { enabled, ...rest } = parsed.data;
  const patch =
    enabled === undefined ? rest : { ...rest, enabled: enabled ? 1 : 0 };
  const updated = updateKnowledgeBase(req.params.id, patch);
  if (!updated) {
    res.status(404).json({ error: "知识库不存在" });
    return;
  }
  res.json(updated);
});

kbRouter.delete("/:id", (req, res) => {
  if (!deleteKnowledgeBase(req.params.id)) {
    res.status(404).json({ error: "知识库不存在" });
    return;
  }
  res.status(204).end();
});
