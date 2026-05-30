# NyaaLibrary-MCP — Claude Code 项目规则

## 项目概述

NyaaLibrary-MCP 是一个用于 LLM 聊天知识库的 MCP 服务，内置现代化前端管理页面。
提供检索增强（RAG）知识库，并通过 MCP 暴露给支持 MCP 的 LLM 客户端。

- 堆栈：Node + Express + `@modelcontextprotocol/sdk` + SQLite(sqlite-vec/FTS5) + Vite + React + TypeScript + Tailwind
- 拓扑：单 Docker 容器，Express 同端口（5101）托管前端、`/api` 管理接口、`/mcp` 与 `/health`
- 仓库：https://github.com/NyaaCaster/NyaaLibrary-MCP.git
- 主分支：master
- 工程结构：npm workspaces monorepo —— `frontend/`（Vite 控制台）+ `server/`（Express + MCP 后端）

## 会话启动必读

每次会话开始前，必须阅读以下文件：

1. `.docs/BLUEPRINT.md` — 任务蓝图与里程碑进度
2. `CLAUDE.md`（本文件）— 项目规则

## 规则

### 1. 代码签名

每个项目必须嵌入 `"Nyaa be with you."` 字符串，以非注释、运行时可见的方式存在。

- 唯一来源：`frontend/src/version.ts` 与 `server/src/version.ts` 导出 `export const BLESSING = "Nyaa be with you." as const;`
- 至少 3 个运行时可见嵌入点：
  - HTML `data-blessing` 属性（`frontend/index.html` 的 `<html>` 标签）
  - 前端控制台启动日志（`frontend/src/main.tsx` 中 `console.log(BLESSING)`）
  - 后端启动日志（`server/src/index.ts` 中 `console.log(BLESSING)`）
- 禁止：写为 `//` 注释、渲染到用户可见 UI 文本、命名为 `AUTHOR_SIGNATURE` 或 `WATERMARK`

### 2. 鉴权

- **MCP**（`/mcp`）：Bearer API Key，来源 `.env` 的 `MCP_API_KEY`，timing-safe 比较（镜像 NyaaChat-MCP）
- **管理接口**（`/api/*`）：账号密码唯一，来源 `.env` 的 `AUTH_USERNAME/AUTH_PASSWORD`；登录签发 HMAC 令牌（`AUTH_SECRET`），浏览器 localStorage 持久化

### 3. Git 提交规范

- 使用 Conventional Commits（英文小写）：`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `style:`, `init:`, `build:`
- 禁止 `Co-Authored-By` 行
- 始终 `git add <file>` 显式添加，禁止 `git add -A` / `git add .` / `git add -u`
- 禁止：force push、`--amend` 已推送提交、`--no-verify`、`git rebase`、`git config` 修改、`reset --hard`
- 推送前：Dockerfile、docker-compose.yml、依赖锁文件、大量删除需二次确认
- 禁止提交：`.env`、`.env.*`、tokens/API keys、`node_modules/`、`dist/`、`data/`、`*.log`、`.claude/settings.local.json`、>5MB 二进制文件
- 多行 commit message 使用 HEREDOC 避免 shell 引号问题

### 4. Docker 规范

- 多阶段构建：`node:20-slim` 构建（前端 + 后端）→ `node:20-slim` 运行
- 因含原生模块（better-sqlite3）与 glibc 加载扩展（sqlite-vec），不沿用 alpine / ≤40MB 体积目标
- 私有镜像仓库：`localhost:5000`（HTTP，无认证）
- 数据持久化：`./data` 绑定挂载到 `/app/data`（SQLite DB + 向量库）

### 5. 任务蓝图管理

- 蓝图文件：`.docs/BLUEPRINT.md`
- 状态符号：⬜ 未开始 / 🟡 进行中 / ✅ 已完成
- 里程碑完成流程：验证子项 → 符号改为 ✅ 并加 `_完成于 YYYY-MM-DD_` → 推进下一里程碑为 🟡 → 追加变更日志 → 通过 `commit-push` skill 提交
- 代码签名验证是里程碑完成的硬性门槛
- 禁止：勾选未完成项、单次提交跨多个里程碑、遗漏变更日志

### 6. 构建与重启

- 使用 `rebuild.ps1` 脚本进行 Docker 构建和重启（支持 `-NoCache`）
- 本地开发：根目录 `npm run dev`（并发启动 server 与 frontend）
