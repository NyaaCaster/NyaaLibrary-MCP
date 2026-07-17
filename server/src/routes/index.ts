import { Router } from "express";
import { requireSession } from "../auth/session.js";
import { authRouter } from "./auth.js";
import { kbRouter } from "./kb.js";
import { libraryRouter } from "./library.js";
import { configRouter } from "./config.js";
import { memoryRouter } from "./memory.js";

export function createApiRouter(): Router {
  const api = Router();

  // Public: login.
  api.use("/auth", authRouter);

  // Memory endpoints: use own auth (KB_SERVER_TOKEN + X-Sender-Id),
  // mounted before the session middleware so they don't need dashboard login.
  api.use("/memory", memoryRouter);

  // Everything below requires a valid management session token.
  api.use(requireSession);
  api.use("/config", configRouter);
  api.use("/kb", kbRouter);
  api.use("/", libraryRouter);

  return api;
}
