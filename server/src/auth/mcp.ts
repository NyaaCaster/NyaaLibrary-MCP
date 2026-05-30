import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

// Mirrors NyaaChat-MCP: a single Bearer key from MCP_API_KEY guards /mcp.
// Empty key disables auth (dev only) with a startup warning.
const API_KEY = config.mcpApiKey;
export const mcpAuthEnabled = API_KEY.length > 0;

function matches(provided: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(API_KEY);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function requireMcpAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!mcpAuthEnabled) {
    next();
    return;
  }
  const header = req.headers.authorization;
  const m = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  if (m && matches(m[1])) {
    next();
    return;
  }
  res.status(401).json({
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message: "Unauthorized: missing or invalid Authorization header",
    },
    id: null,
  });
}
