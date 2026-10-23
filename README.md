# NyaaLibrary-MCP

> 双功能服务：LLM 知识库 RAG + 猫猫智能框架本体记忆存储。

单 Docker 容器，Express 同端口托管前端管理页面、REST API、MCP 端点。两套功能共享 SQLite + sqlite-vec + FTS5 检索基础设施，但鉴权和数据模型完全隔离。

## 技术堆栈

- **后端**：Node 20 · TypeScript(ESM) · Express · `@modelcontextprotocol/sdk` · `better-sqlite3`
- **检索**：sqlite-vec（稠密 KNN）+ FTS5（稀疏 BM25）+ RRF 融合
- **前端**：Vite · React 19 · TypeScript · Tailwind CSS · React Router · TanStack Query
- **部署**：单 Docker 容器（`node:20-slim`），多阶段构建；`rebuild.py` 推送私有仓库，`restart.py` 部署到 macmini

## 端口

| 环境 | 宿主机端口 | 容器端口 | compose 文件 |
|------|-----------|---------|-------------|
| 本地开发 | **5114** | 5101 | `docker-compose.yml` |
| macmini 部署 | 5114 | 5101 | 部署时 `docker-compose.publish.yml` → `docker-compose.yml` |

> 容器内始终监听 `5101`。端口映射的变更只改 compose 文件的 `ports` 段，不改 `.env` 中的 `APP_PORT`。

## 架构

```
                         ┌─────────────────────────┐
                         │  NyaaLibrary-MCP :5114  │
                         │  (Express 单进程)        │
                         └───────────┬─────────────┘
                                     │
        ┌────────────┬───────────────┼───────────────┬────────────┐
        ▼            ▼               ▼               ▼            ▼
   / (前端 SPA)  /api/auth/*   /api/memory/*   /api/kb/*     /mcp
   管理控制台     登录/会话      本体记忆 API    知识库管理    MCP端点
   账号密码       HMAC令牌      Bearer+SenderId  Session      API Key
```

## 两套 API 体系

### 知识库 RAG（前端管理 + MCP）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| `GET/POST` | `/api/auth/*` | — | 登录 / 登出 / 状态 |
| `GET/POST/PUT/DELETE` | `/api/kb/*` | Session token | 知识库 CRUD |
| `POST` | `/api/upload` | Session token | 文档上传（.txt/.md/.pdf/.docx/.epub/.xlsx） |
| `GET` | `/api/config` | Session token | 嵌入模型配置 |
| `/mcp` | Streamable HTTP + SSE | `MCP_API_KEY` | MCP 协议端点，暴露 `list_knowledge_bases` + `search_knowledge_base` |

### 本体记忆（猫猫智能框架 V2-P6/P7）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| `GET` | `/api/memory/profile` | `KB_SERVER_TOKEN` + `X-Sender-Id` | 读用户画像 |
| `PUT` | `/api/memory/profile` | 同上 | 写画像（字段级 merge） |
| `POST` | `/api/memory/write` | 同上 | 写记忆沉淀（embed → 事务写三表） |
| `POST` | `/api/memory/search` | 同上 | 混合检索（dense + sparse + RRF） |
| `POST` | `/api/memory/forget` | 同上 | 按 hint 淘汰旧记忆 |

**安全红线**：所有记忆端点强制 `WHERE owner_key = :sender_id`，由成对 token 建立可信调用端 + 服务端 SQL 强制过滤。跨 owner 越权测试必须失败。

### 鉴权差异

| API 组 | 鉴权方式 | Fail 行为 | 适用场景 |
|--------|---------|----------|---------|
| `/mcp` | MCP_API_KEY (Bearer) | Dev-open（空 key 放行） | 外部 LLM 客户端接入 |
| `/api/*` (管理) | AUTH_USERNAME/AUTH_PASSWORD → HMAC session | 未登录跳转 | 人类通过 WebUI 管理 |
| `/api/memory/*` | KB_SERVER_TOKEN (Bearer) + X-Sender-Id | **Fail-closed**（空 token 拒绝一切） | 程序间调用 |

## 数据模型

```
library.db
├── knowledge_bases          # RAG 知识库（原有）
├── documents / chunks       # 文档分块（原有）
├── chunks_fts (FTS5)        # 知识库检索（原有）
├── profiles                 # 🆕 用户画像（sender_id PK, profile_json）
├── memory_entries           # 🆕 记忆沉淀（owner_key, content, salience, last_access）
├── mem_fts (FTS5 trigram)   # 🆕 记忆稀疏检索
└── vec_mem (sqlite-vec)     # 🆕 记忆向量检索（懒创建）
```

## 项目结构

```
NyaaLibrary-MCP/
├── docker-compose.yml              # 本地开发（build from source, 5114:5101）
├── docker-compose.publish.yml      # macmini 部署（pull from registry）
├── Dockerfile                      # 多阶段：build frontend + server → runner
├── rebuild.py                      # Windows 构建 + 推送到 NyaaDockerHUB
├── restart.py                      # macmini 拉取 + 重启
├── rebuild.ps1                     # 旧脚本（待迁移）
├── .env / .env.example             # 环境配置
├── meta.json                       # 项目元数据
├── frontend/                       # Vite + React 管理控制台
│   └── src/ (pages/ components/ lib/ version.ts)
├── server/                         # Express + MCP 后端
│   └── src/
│       ├── index.ts                # 入口
│       ├── server.ts               # MCP server 工厂
│       ├── config.ts               # .env 解析
│       ├── auth/                   # 鉴权中间件
│       │   ├── session.ts          # 管理端 session
│       │   ├── mcp.ts              # MCP API Key
│       │   └── memory.ts           # 🆕 KB_SERVER_TOKEN + X-Sender-Id
│       ├── db/index.ts             # DDL（含 profiles + memory_entries）
│       ├── services/
│       │   ├── memory.ts           # 🆕 画像 CRUD + 沉淀写入 + 混合检索 + 遗忘
│       │   ├── retrieval.ts        # RAG 检索
│       │   └── embedding.ts        # 嵌入模型调用
│       ├── routes/
│       │   ├── index.ts            # 路由挂载
│       │   ├── memory.ts           # 🆕 /api/memory/* 路由
│       │   └── ...                 # kb / auth / config 路由
│       └── tools/
│           └── knowledgeBase.ts    # MCP 工具注册
└── data/                           # SQLite DB（bind mount，不入库）
```

## 快速开始

### 1. 配置

```powershell
copy .env.example .env
# 编辑 .env：必须填写 MCP_API_KEY / AUTH_SECRET / AUTH_PASSWORD 和 KB_SERVER_TOKEN
```

### 2. 本地开发

```powershell
npm install            # npm workspaces（frontend + server）
npm run dev            # 后端 :5101 + Vite 开发服务器
```

### 3. Docker 本地运行

```powershell
docker compose up -d
# 访问 http://localhost:5114
```

### 4. 部署到 macmini

```powershell
# Windows 构建推送
python rebuild.py

# 传输文件
scp -P 22141 docker-compose.publish.yml restart.py .env \
    macmini:/root/DockerContainer/NyaaLibrary-MCP/
ssh macmini -p 22141 \
    "cd /root/DockerContainer/NyaaLibrary-MCP && mv docker-compose.publish.yml docker-compose.yml"

# macmini 启动
ssh macmini -p 22141
mkdir -p /root/DockerContainer/DockerRes/nyaalibrary-mcp/data
chown -R 1000:1000 /root/DockerContainer/DockerRes/nyaalibrary-mcp/data
cd /root/DockerContainer/NyaaLibrary-MCP
export PATH=$PATH:/snap/bin
python3 restart.py
```

## 配置项（.env）

| 变量 | 默认 | 说明 |
|------|------|------|
| `APP_PORT` | 5101 | 容器内监听端口 |
| `HOST` | 0.0.0.0 | 绑定地址 |
| `MCP_API_KEY` | — | MCP 端点 Bearer 鉴权 |
| `AUTH_USERNAME` | — | 前端登录用户名 |
| `AUTH_PASSWORD` | — | 前端登录密码 |
| `AUTH_SECRET` | — | HMAC 令牌签名密钥（64 位 hex） |
| `AUTH_TOKEN_TTL_HOURS` | 720 | 登录有效期 |
| `MAX_FILE_SIZE_MB` | 128 | 上传文件大小上限 |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | 512 / 50 | 文档分块参数 |
| `RETRIEVAL_TOP_K` | 5 | 检索返回条数 |
| `DENSE_TOP_K` / `SPARSE_TOP_K` | 50 / 50 | 混合检索召回数 |
| `EMBEDDING_BASE_URL` / `_API_KEY` / `_MODEL` / `_DIM` | — | 嵌入模型（可在前端配置） |
| `KB_SERVER_TOKEN` | — | 🆕 记忆端点成对鉴权服务端 |
| `PRIVATE_DOCKER_REGISTRY_HOST` | — | 私有仓库地址 |
| `TZ` | Asia/Shanghai | 时区 |

## MCP 接入

```json
{
  "type": "streamableHttp",
  "url": "http://192.168.31.141:5114/mcp",
  "headers": {
    "Authorization": "Bearer <MCP_API_KEY>"
  }
}
```

可用 MCP 工具：`list_knowledge_bases`、`search_knowledge_base`

## 记忆 API 接入（程序调用）

```bash
# 读取画像
curl http://localhost:5114/api/memory/profile \
  -H "Authorization: Bearer <KB_SERVER_TOKEN>" \
  -H "X-Sender-Id: 1369356335"

# 写入画像
curl -X PUT http://localhost:5114/api/memory/profile \
  -H "Authorization: Bearer <KB_SERVER_TOKEN>" \
  -H "X-Sender-Id: 1369356335" \
  -H "Content-Type: application/json" \
  -d '{"profile_patch": {"名字": "老张", "职业": "后端开发"}}'

# 搜索记忆
curl -X POST http://localhost:5114/api/memory/search \
  -H "Authorization: Bearer <KB_SERVER_TOKEN>" \
  -H "X-Sender-Id: 1369356335" \
  -H "Content-Type: application/json" \
  -d '{"query": "用户偏好", "top_k": 5}'
```

## License

AGPL-3.0 — 详见 [LICENSE](LICENSE)

## R1 reliable memory protocol

`POST /api/memory/v2/snapshot` accepts `{query, sources:[{id, author, role:"user", content}]}`; author must match authenticated X-Sender-Id. It freezes owner candidates and profile revision. `POST /api/memory/v2/batches` accepts `operation_id`, `snapshot_id`, optional `parent_id`, `nickname`, `profile_patch`, `delete_paths`, `memory_entries` (salience 0..1), and `removals` (id/version/source_id/evidence/reason). Accepted is 202, **not committed**. Poll `GET /api/memory/v2/batches/:id`; only `committed` confirms the atomic transaction. Same ID/same canonical body replays; different body returns 409. Parked operations retain their intent; management session may inspect `/api/owners/operations/status` and retry `/api/owners/:owner/operations/:id/retry`.

Profiles in v2 deep merge objects, replace arrays and preserve false/0; JSON Pointer delete_paths explicitly retract fields. Legacy profile merge remains shallow for compatibility. Legacy `/write` remains synchronous; `/forget` now returns `UPGRADE_REQUIRED_USE_SNAPSHOT_REMOVALS` (409). Semantic similarity never deletes facts. Destructive evidence must quote the selected old fact verbatim and explicitly retract/correct it; uncertain cases retain both.

Memory vectors have a model/endpoint/dimension fingerprint. Unknown or changed spaces reject writes; no automatic DROP. Use `node server/dist/tools/rebuildMemoryIndex.js` against an isolated DB copy to prepare a resumable artifact, then `--activate` with `MEMORY_MAINTENANCE=1` and all writers stopped. Activation backs up DB, archives old vectors and transactionally switches only memory indices. Ordinary knowledge-base indices are unchanged. DATA_DIR/.r1-maintenance.json may contain `{ "active": true, "smokeOwner": "isolated-owner" }`; malformed maintenance files fail closed.

Validation: `npx tsx server/tests/memory-r1.test.ts` uses a disposable DB, real sqlite-vec, and mock embeddings; cleans all generated files. Also run `npm run typecheck` and `npm run build`.


## R1 可靠记忆协议（0.2.0）

记忆调用方通过 `KB_SERVER_TOKEN` 与 `X-Sender-Id` 鉴权。`POST /api/memory/v2/snapshot` 冻结本人来源、画像 revision 和旧候选；`POST /api/memory/v2/batches` 持久接受批次，202 仅代表已接受。调用方持久化 operation_id 和完整请求，超时后先 `GET /api/memory/v2/batches/:id`，只有 committed 才清原文。同 ID 同体可重放，异体返回 409。画像递归合并保留 false/0，删除字段使用 JSON Pointer delete_paths。相似度不会自动删除；撤回必须引用快照旧 ID/version 和本人明确证据。

旧 write 继续同步确认；旧 profile merge 保留浅合并语义。**旧 hint-only forget 返回 409，必须升级为快照精确撤回或管理员精确删除。** 向量空间/维度不匹配拒写，禁止普通写入重建表。

`/health` 表示进程活着；`/ready` 同时验证 schema、记忆空间、维度及正文/向量/双FTS数量和rowid。`DATA_DIR/.r1-maintenance.json` 存在时阻止外部写，JSON 可配置仅用于隔离验证的 smoke_owner；坏文件保持维护。管理 session 仍与记忆 token 分开，可查询 `/api/owners/operations/status` 并对明确 parked 批次重试（具体路由见 owners.ts）。

迁移前使用 SQLite backup API 创建一致快照。用相同 Embedding 环境运行 `node dist/tools/rebuildMemoryIndex.js` 生成可断点影子，再停写并设置维护模式，执行同命令 `--activate`。旧向量隔离到 memory_vector_archive，不重提炼正文、不更动普通知识库索引。维护前备份，失败保留影子与新待办；放行后禁止用旧库覆盖新数据。详细发布和恢复以跨项目 R1 SSOT 为准。

验证：`npm run typecheck`、`npm run build`、`npx tsx server/tests/memory-r1.test.ts`、`npx tsx server/tests/memory-http-r1.test.ts`。测试使用独立临时目录与 mock Embedding，自动清理。专项镜像发布用 `python rebuild.py --skip-cleanup` 保留回滚镜像，不启动本机服务。
