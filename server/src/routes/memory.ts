import { Router, type Request, type Response } from "express";
import { requireMemoryAuth, requireSenderId } from "../auth/memory.js";
import {
  getProfile,
  upsertProfile,
  writeMemory,
  searchMemory,
  forgetMemories,
} from "../services/memory.js";
import { config } from "../config.js";

export const memoryRouter = Router();

// All memory routes require both auth layers (决策 F4: fail-closed, owner isolation).
memoryRouter.use(requireMemoryAuth);
memoryRouter.use(requireSenderId);

/**
 * GET /api/memory/profile — 按 sender_id 读取画像。
 * Header: X-Sender-Id + Authorization: Bearer <token>
 * 响应：200 + ProfileRow | 404 { error: "未找到画像" }
 */
memoryRouter.get("/profile", (req: Request, res: Response) => {
  const ownerKey = (req as any).ownerKey as string;
  const profile = getProfile(ownerKey);
  if (!profile) {
    res.status(404).json({ error: "未找到画像" });
    return;
  }
  res.json(profile);
});

/**
 * PUT /api/memory/profile — 写画像。
 * Body: { nickname?: string, profile_patch?: object, merge_mode?: "merge" | "replace" }
 * merge_mode 默认 "merge"（向后兼容），"replace" 整条覆盖。
 * 响应：200 + ProfileRow
 */
memoryRouter.put("/profile", (req: Request, res: Response) => {
  const ownerKey = (req as any).ownerKey as string;
  const { nickname, profile_patch, merge_mode } = req.body ?? {};

  if (profile_patch !== undefined && typeof profile_patch !== "object") {
    res.status(400).json({ error: "profile_patch 必须是对象" });
    return;
  }

  const mergeMode: "merge" | "replace" =
    merge_mode === "replace" ? "replace" : "merge";
  const profile = upsertProfile(ownerKey, nickname, profile_patch, mergeMode);
  res.json(profile);
});

/**
 * POST /api/memory/write — 写沉淀。
 * Body: { content: string, salience?: number }
 * 响应：201 { id, chunk_count }
 */
memoryRouter.post("/write", async (req: Request, res: Response) => {
  const ownerKey = (req as any).ownerKey as string;
  const { content, salience } = req.body ?? {};

  if (typeof content !== "string" || !content.trim()) {
    res.status(400).json({ error: "content 必须是非空字符串" });
    return;
  }

  try {
    const result = await writeMemory(ownerKey, content.trim(), salience);
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[memory] write failed:", msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/memory/search — 按 owner_key 检索沉淀。
 * Body: { query: string, top_k?: number }
 * 响应：200 { hits: MemoryHit[] }
 */
memoryRouter.post("/search", async (req: Request, res: Response) => {
  const ownerKey = (req as any).ownerKey as string;
  const { query, top_k } = req.body ?? {};

  if (typeof query !== "string" || !query.trim()) {
    res.status(400).json({ error: "query 必须是非空字符串" });
    return;
  }

  const topK =
    typeof top_k === "number" && top_k > 0
      ? top_k
      : config.retrieval.topK;

  try {
    const hits = await searchMemory(ownerKey, query.trim(), topK);
    res.json({ hits });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[memory] search failed:", msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/memory/forget — 按 hint 删除 owner 的匹配记忆条目（P7 遗忘机制）。
 * Body: { hints: string[] }
 * 响应：200 { deleted: number }
 */
memoryRouter.post("/forget", (req: Request, res: Response) => {
  const ownerKey = (req as any).ownerKey as string;
  const { hints } = req.body ?? {};

  if (!Array.isArray(hints) || hints.length === 0) {
    res.status(400).json({ error: "hints 必须是非空数组" });
    return;
  }
  for (const h of hints) {
    if (typeof h !== "string" || !h.trim()) {
      res.status(400).json({ error: "hints 中每条必须是非空字符串" });
      return;
    }
  }

  const result = forgetMemories(ownerKey, hints);
  res.json(result);
});
