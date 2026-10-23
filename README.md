# NyaaLibrary-MCP

> 当前版本 **0.2.0**。双功能服务：LLM 知识库 RAG + 猫猫智能框架本体记忆存储。

单 Docker 容器，Express 同端口托管前端管理页面、REST API、MCP 端点。两套功能共享 SQLite + sqlite-vec + FTS5 检索基础设施，但鉴权和数据模型完全隔离。

## 技术堆栈

- **后端**：Node 20 · TypeScript(ESM) · Express · `@modelcontextprotocol/sdk` · `better-sqlite3`
- **检索**：sqlite-vec + FTS5 + RRF 融合；普通知识库使用 KNN，记忆检索在 owner 范围内精确评分并融合双 FTS
- **前端**：Vite · React 19 · TypeScript · Tailwind CSS · React Router · TanStack Query
- **部署**：单 Docker 容器（`node:20-slim`），多阶段构建；`rebuild.py` 推送私有仓库，`restart.py` 部署到 macmini

## 端口

| 环境 | 宿主机端口 | 容器端口 | compose 文件 |
|------|-----------|---------|-------------|
| 本地源码开发 | 后端 **5101** | — | `npm run dev` |
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

### 本体记忆（R1）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| `GET` | `/api/memory/profile` | `KB_SERVER_TOKEN` + `X-Sender-Id` | 读用户画像 |
| `PUT` | `/api/memory/profile` | 同上 | 兼容写画像（顶层浅合并） |
| `POST` | `/api/memory/write` | 同上 | 兼容同步写入（嵌入、正文与索引事务） |
| `POST` | `/api/memory/search` | 同上 | 混合检索（dense + sparse + RRF） |
| `POST` | `/api/memory/forget` | 同上 | 已停用，返回 409 `UPGRADE_REQUIRED_USE_SNAPSHOT_REMOVALS` |
| `POST` | `/api/memory/v2/snapshot` | 同上 | 冻结本人来源、旧候选与画像 revision |
| `POST` | `/api/memory/v2/batches` | 同上 | 持久接受幂等批次，202 不代表提交完成 |
| `GET` | `/api/memory/v2/batches/:id` | 同上 | 查询本 owner 批次状态 |

记忆条目按 `owner_key` 隔离，画像按 `sender_id` 隔离。`X-Sender-Id` 是持有共享 token 的可信程序声明，不能替代终端用户独立鉴权；不要把共享 token 交给不可信客户端。当前沿用裸 sender_id，跨平台同号共享。

管理 session 可使用 `/api/owners` 查看 owner，使用 `/api/owners/:ownerKey/memory` 查询或添加条目，使用 `DELETE /api/owners/:ownerKey/memory/:id` 精确删除；画像管理为 `GET/PUT/DELETE /api/owners/:ownerKey/profile`。这些路由与记忆 token 鉴权分开。

### 鉴权差异

| API 组 | 鉴权方式 | Fail 行为 | 适用场景 |
|--------|---------|----------|---------|
| `/mcp` | MCP_API_KEY (Bearer) | Dev-open（空 key 放行） | 外部 LLM 客户端接入 |
| `/api/*` (管理) | AUTH_USERNAME/AUTH_PASSWORD → HMAC session | 未登录拒绝 | 人类通过 WebUI 管理 |
| `/api/memory/*` | KB_SERVER_TOKEN (Bearer) + X-Sender-Id | **Fail-closed**（空 token 拒绝一切） | 程序间调用 |

## 数据模型

```
library.db
├── knowledge_bases          # RAG 知识库（原有）
├── documents / chunks       # 文档分块（原有）
├── chunks_fts (FTS5)        # 知识库检索（原有）
├── profiles                 # 🆕 用户画像（sender_id PK, profile_json）
├── memory_entries           # 🆕 记忆沉淀（owner_key, content, salience, last_access）
├── mem_fts / mem_fts_cjk    # 记忆双 FTS 检索
├── vec_mem (sqlite-vec)     # 记忆向量，空间绑定 endpoint/model/dim
├── memory_owner_revisions  # owner revision
├── memory_snapshots        # 冻结来源与旧候选
├── memory_operations       # 持久批次、状态与幂等凭证
└── memory_vector_archive   # 显式索引切换时归档旧向量
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
│       │   ├── memory.ts           # 🆕 画像 CRUD + 沉淀写入 + 混合检索
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

### 3. 镜像构建与部署

Windows 仅用于研发、构建与推送，不启动服务容器。构建前在本机 `.env` 配置 `PRIVATE_DOCKER_REGISTRY_HOST`：

```powershell
python rebuild.py --skip-cleanup
```

`--skip-cleanup` 保留回滚镜像。新部署时将发布 compose 和 `restart.py` 安装到 macmini 的 `/root/DockerContainer/NyaaLibrary-MCP/`，发布 compose 命名为 `docker-compose.yml`；单独配置远端 `.env`。数据目录挂载到 `/app/data`，按发布 compose 准备宿主机目录与权限。已有实例升级前先备份，保留远端凭据、数据库和部署覆盖文件，避免直接覆盖 `.env`。

**当前 macmini R1 固定版本**同时加载 `docker-compose.yml` 与 `docker-compose.r1.yml`。原 `restart.py` 只加载基础 compose 并拉取 latest，直接执行会丢失固定版本约束。保持已部署版本的启动或配置核对在 macmini 执行：

```bash
cd /root/DockerContainer/NyaaLibrary-MCP
export PATH="$PATH:/snap/bin"
docker compose -f docker-compose.yml -f docker-compose.r1.yml up -d --no-build --pull never
curl -fsS http://127.0.0.1:5114/ready
```

新版本发布需先明确镜像与覆盖文件，再按专项 SSOT 备份、迁移、部署与验收。`/health` 仅表示进程存活，不能代替 `/ready` 的索引一致性检查。

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
  -H "X-Sender-Id: example-user"

# 写入画像
curl -X PUT http://localhost:5114/api/memory/profile \
  -H "Authorization: Bearer <KB_SERVER_TOKEN>" \
  -H "X-Sender-Id: example-user" \
  -H "Content-Type: application/json" \
  -d '{"profile_patch": {"名字": "老张", "职业": "后端开发"}}'

# 搜索记忆
curl -X POST http://localhost:5114/api/memory/search \
  -H "Authorization: Bearer <KB_SERVER_TOKEN>" \
  -H "X-Sender-Id: example-user" \
  -H "Content-Type: application/json" \
  -d '{"query": "用户偏好", "top_k": 5}'
```

## R1 可靠记忆协议（0.2.0）

记忆调用方通过 `KB_SERVER_TOKEN` 与 `X-Sender-Id` 鉴权。`POST /api/memory/v2/snapshot` 冻结本人来源、画像 revision 和旧候选；`POST /api/memory/v2/batches` 持久接受批次，202 仅代表已接受。调用方持久化 operation_id 和完整请求，超时后先 `GET /api/memory/v2/batches/:id`，只有 committed 才清原文。同 ID 同体可重放，异体返回 409。画像递归合并保留 false/0，删除字段使用 JSON Pointer delete_paths。相似度不会自动删除；撤回必须引用快照旧 ID/version 和本人明确证据。

旧 write 继续同步确认；旧 profile merge 保留浅合并语义。**旧 hint-only forget 返回 409，必须升级为快照精确撤回或管理员精确删除。** 向量空间/维度不匹配拒写，禁止普通写入重建表。

`/health` 表示进程活着；`/ready` 同时验证 schema、记忆空间、维度及正文/向量/双FTS数量和rowid。`DATA_DIR/.r1-maintenance.json` 存在时阻止外部写，JSON 可配置 `{"smoke_owner":"isolated-owner"}` 为隔离验证 owner 放行；文件存在即进入维护，坏文件保持维护。`MEMORY_MAINTENANCE=1` 强制维护且无 owner 例外。管理 session 仍与记忆 token 分开，可对明确 parked 批次重试：`POST /api/owners/:ownerKey/operations/:id/retry`；状态查询为 `GET /api/owners/operations/status`。

迁移前使用 SQLite backup API 创建一致快照。在隔离数据库副本上、使用相同 Embedding 配置生成可断点影子。命令路径取决于工作目录：

| 工作目录 | 准备命令（先完成构建） |
|----------|----------------------|
| 仓库根目录 | `node server/dist/tools/rebuildMemoryIndex.js` |
| 容器 `/app` | `node dist/tools/rebuildMemoryIndex.js` |

通过 `DATA_DIR` 指定目标数据库目录、`MEMORY_INDEX_ARTIFACT` 指定影子文件；激活前停止所有写入方与原服务，在维护进程中设置 `MEMORY_MAINTENANCE=1`，对正确目标及影子执行对应命令并加 `--activate`。旧向量隔离到 memory_vector_archive，不重提炼正文、不更动普通知识库索引。维护前备份，失败保留影子与新待办；放行后禁止用旧库覆盖新数据。详细发布和恢复以跨项目 R1 SSOT 为准。

验证：`npm run typecheck`、`npm run build`、`npx tsx server/tests/memory-r1.test.ts`、`npx tsx server/tests/memory-http-r1.test.ts`。测试使用独立临时目录与 mock Embedding，自动清理。专项镜像发布用 `python rebuild.py --skip-cleanup` 保留回滚镜像，不启动本机服务。

批次请求包含 `operation_id`、`snapshot_id`，以及可选 `parent_id`、`nickname`、`profile_patch`、`delete_paths`、`memory_entries` 和 `removals`。快照来源为 `{id, author, role:"user", content}`，author 必须匹配 `X-Sender-Id`；撤回条目包含 `id/version/source_id/evidence/reason`，reason 为 `correction` 或 `retraction`。memory_entries 的 salience 范围为 0..1。v2 画像递归合并对象、替换数组，显式删除字段用 JSON Pointer。

服务批次状态为 `pending`、`processing`、`retry_wait`、`parked`、`committed`；只有 committed 表示事务提交。停放操作保留意图，管理员核对后再重试。记忆检索 query 最长 2000 字符，top_k 必须为 1..50 的整数；记忆正文最长 4000 字符。

猫猫插件每轮使用精确画像读取与临时注入形成记忆使用链路，服务提供 `/api/memory/search` 不意味着调用方必须每轮调用。R1 未回扫重提炼历史，不改变原用户的裸 sender_id 归属。

专项计划和运维证据位于本地工作空间 `H:/GitHub/AstrbotDev/.docs/astrbot插件猫猫智能框架/` 下的 `优化修正计划-SSOT.md`、`验收证据-R1.md`、`阶段交接-R1-006.md`；仓库内索引见 [.docs/BLUEPRINT.md](.docs/BLUEPRINT.md)。

## License

AGPL-3.0 — 详见 [LICENSE](LICENSE)
