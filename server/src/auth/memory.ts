import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

// 成对 token 鉴权：镜像 auth/mcp.ts 的 timing-safe 模式，但 fail-closed
// （空 token 拒绝一切，与 MCP 的 dev-open 不同）。
// 决策 F4：成对 token 可信 + sender_id 强制 owner 过滤。

const TOKEN = config.memoryServerToken;
export const memoryAuthEnabled = TOKEN.length > 0;

function matches(provided: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 校验 Authorization: Bearer <KB_SERVER_TOKEN>。
 * fail-closed：若 KB_SERVER_TOKEN 未配置则拒绝一切请求。
 */
export function requireMemoryAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!memoryAuthEnabled) {
    // Fail-closed: 与 MCP auth 不同，空 token 绝不开放。
    console.warn("[memory] KB_SERVER_TOKEN is empty — rejecting all /api/memory requests.");
    res.status(401).json({ error: "Unauthorized: server not configured" });
    return;
  }
  const header = req.headers.authorization;
  const m = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  if (m && matches(m[1])) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized: missing or invalid Authorization header" });
}

/**
 * 从 X-Sender-Id header 提取 owner_key。
 * 强制存在——缺失返回 400。
 * 服务端唯一可信 owner 来源，后续所有查询/写入强制用它过滤。
 */
export function requireSenderId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const sid = req.headers["x-sender-id"];
  if (typeof sid !== "string" || !sid.trim()) {
    res.status(400).json({ error: "缺少 X-Sender-Id" });
    return;
  }
  (req as any).ownerKey = sid.trim();
  next();
}
