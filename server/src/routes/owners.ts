import { Router } from "express";
import { z } from "zod";
import {
  listOwners,
  listMemoryByOwner,
  deleteMemoryById,
  deleteProfile,
  dimensionInSync,
  getProfile,
  upsertProfile,
  writeMemory,
} from "../services/adminMemory.js";

export const ownersRouter = Router();

// ====== 校验 schema ======

const postMemorySchema = z.object({
  content: z.string().min(1, "content 必须是非空字符串"),
  salience: z.number().optional(),
});

const putProfileSchema = z.object({
  nickname: z.string().optional(),
  profile_patch: z.record(z.unknown()).optional(),
  merge_mode: z.enum(["merge", "replace"]).optional().default("merge"),
});

// ====== GET /api/owners — owner 列表 ======

ownersRouter.get("/", (_req, res) => {
  res.json(listOwners());
});

// ====== GET /api/owners/:ownerKey/memory — 记忆条目列表 ======

ownersRouter.get("/:ownerKey/memory", (req, res) => {
  res.json(listMemoryByOwner(req.params.ownerKey));
});

// ====== POST /api/owners/:ownerKey/memory — 补充写入记忆 ======

ownersRouter.post("/:ownerKey/memory", async (req, res) => {
  const parsed = postMemorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "content 必须是非空字符串" });
    return;
  }

  // D1 维度一致守卫：不一致则拒写，绝不静默 DROP 重建 vec_mem
  if (!dimensionInSync()) {
    res.status(409).json({
      error:
        "当前嵌入配置维度与已建向量表维度不一致，无法补充写入。请检查嵌入模型设置。",
    });
    return;
  }

  try {
    const result = await writeMemory(
      req.params.ownerKey,
      parsed.data.content,
      parsed.data.salience ?? 0.5,
    );
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[owners] write memory failed:", msg);
    res.status(500).json({ error: msg });
  }
});

// ====== DELETE /api/owners/:ownerKey/memory/:id — 精确删除记忆 ======

ownersRouter.delete("/:ownerKey/memory/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "id 必须是正整数" });
    return;
  }
  if (!deleteMemoryById(req.params.ownerKey, id)) {
    res.status(404).json({ error: "记忆条目不存在或无权操作" });
    return;
  }
  res.status(204).end();
});

// ====== GET /api/owners/:ownerKey/profile — 读取画像 ======

ownersRouter.get("/:ownerKey/profile", (req, res) => {
  const profile = getProfile(req.params.ownerKey);
  if (!profile) {
    res.status(404).json({ error: "该 owner 暂无画像" });
    return;
  }
  res.json(profile);
});

// ====== PUT /api/owners/:ownerKey/profile — 写画像（字段级 merge）======

ownersRouter.put("/:ownerKey/profile", (req, res) => {
  const parsed = putProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "参数无效" });
    return;
  }
  const { nickname, profile_patch, merge_mode } = parsed.data;

  // 校验 profile_patch 在提交时至少有一个有效字段
  if (nickname === undefined && profile_patch === undefined) {
    res.status(400).json({ error: "至少需要提供 nickname 或 profile_patch" });
    return;
  }

  const profile = upsertProfile(
    req.params.ownerKey,
    nickname,
    profile_patch as Record<string, unknown> | undefined,
    merge_mode,
  );
  res.json(profile);
});

// ====== DELETE /api/owners/:ownerKey/profile — 删除画像 ======

ownersRouter.delete("/:ownerKey/profile", (req, res) => {
  if (!deleteProfile(req.params.ownerKey)) {
    res.status(404).json({ error: "该 owner 暂无画像" });
    return;
  }
  res.status(204).end();
});
