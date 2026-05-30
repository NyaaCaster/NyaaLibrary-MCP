import { Router } from "express";
import { z } from "zod";
import { checkCredentials, issueToken } from "../auth/session.js";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "用户名和密码不能为空" });
    return;
  }
  const { username, password } = parsed.data;
  if (!checkCredentials(username, password)) {
    res.status(401).json({ error: "用户名或密码错误" });
    return;
  }
  res.json({ token: issueToken(username), username });
});
