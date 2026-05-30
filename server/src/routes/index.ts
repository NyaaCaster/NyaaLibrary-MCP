import { Router } from "express";
import { requireSession } from "../auth/session.js";
import { authRouter } from "./auth.js";
import { kbRouter } from "./kb.js";
import { embeddingRouter } from "./embedding.js";
import { libraryRouter } from "./library.js";

export function createApiRouter(): Router {
  const api = Router();

  // Public: login.
  api.use("/auth", authRouter);

  // Everything below requires a valid management session token.
  api.use(requireSession);
  api.use("/kb", kbRouter);
  api.use("/embedding", embeddingRouter);
  api.use("/", libraryRouter);

  return api;
}
