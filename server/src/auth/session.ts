import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

// Lightweight stateless session token (HMAC-signed, JWT-like) for the
// management API. The single account/password lives in .env. The browser
// stores the returned token and sends it as `Authorization: Bearer <token>`.

const SECRET = config.auth.secret || "insecure-dev-secret";

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function issueToken(subject: string): string {
  const exp = Date.now() + config.auth.tokenTtlHours * 3600 * 1000;
  const body = b64url(JSON.stringify({ sub: subject, exp }));
  return `${body}.${sign(body)}`;
}

function verifyToken(token: string): boolean {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}

/** Validate credentials against the unique account in .env (timing-safe). */
export function checkCredentials(username: string, password: string): boolean {
  const u = Buffer.from(username);
  const eu = Buffer.from(config.auth.username);
  const p = Buffer.from(password);
  const ep = Buffer.from(config.auth.password);
  const userOk = u.length === eu.length && timingSafeEqual(u, eu);
  const passOk =
    config.auth.password.length > 0 &&
    p.length === ep.length &&
    timingSafeEqual(p, ep);
  return userOk && passOk;
}

export function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  const m = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  if (m && verifyToken(m[1])) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
}
