# NyaaLibrary-MCP

> 用于 LLM 聊天知识库的 MCP —— 内置现代化前端管理页面的检索增强（RAG）知识库服务。

通过 MCP（Model Context Protocol）将本地知识库暴露给任意支持 MCP 的 LLM 客户端，
并提供一个账号密码保护的 Web 控制台用于知识库 / 文档管理、检索测试与嵌入模型配置。

## 技术堆栈

- **后端**：Node 20 · TypeScript(ESM) · Express · [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol)
- **检索**：内嵌 SQLite（`better-sqlite3`）+ `sqlite-vec`（稠密向量 KNN）+ FTS5（稀疏 BM25）+ RRF 融合
- **前端**：Vite · React 19 · TypeScript · Tailwind CSS · React Router · TanStack Query
- **部署**：单 Docker 容器（Express 同时托管前端、`/api` 与 `/mcp`）

## 架构

单进程、单容器、零外部依赖。Express 在同一端口（默认 5101）上提供三类服务：

| 路径       | 用途                 | 鉴权                                  |
| ---------- | -------------------- | ------------------------------------- |
| `/`        | 前端管理控制台       | 账号密码登录（令牌存浏览器 localStorage） |
| `/api/*`   | 管理 REST 接口       | 登录令牌（`Authorization: Bearer`）     |
| `/mcp`     | MCP 端点（供 LLM）   | API Key（`Authorization: Bearer`）      |
| `/health`  | 健康检查             | 无                                    |

`/mcp` 同时支持 Streamable HTTP（标准）与 SSE（兼容旧客户端）。

## 项目结构

```
NyaaLibrary-MCP/
├── meta.json               # 项目元数据（唯一来源）
├── docker-compose.yml      # 单服务编排（端口 5101，挂载 ./data）
├── Dockerfile              # 多阶段：构建前端 + 后端 → node:20-slim 运行
├── rebuild.ps1             # Docker 构建重启脚本
├── .env / .env.example     # 环境配置（.env 含密钥，不纳入版本管理）
├── frontend/               # Vite + React 管理控制台
│   └── src/ (pages/ components/ lib/ version.ts)
└── server/                 # Express + MCP 后端
    └── src/ (index.ts server.ts auth/ db/ services/ routes/ tools/)
```

## 端口与镜像

| 服务 | 容器名            | 端口      | 镜像                   |
| ---- | ----------------- | --------- | ---------------------- |
| app  | nyaalibrary-mcp   | 5101:5101 | nyaalibrary-mcp:latest |

## 快速开始

### 1. 配置环境

```powershell
copy .env.example .env
# 编辑 .env：生成并填入 MCP_API_KEY / AUTH_SECRET，设置 AUTH_USERNAME / AUTH_PASSWORD
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. 本地开发

```powershell
npm install            # 安装 frontend + server（npm workspaces）
npm run dev            # 同时启动后端(5101)与前端(Vite 开发服务器，代理 /api 与 /mcp)
```

打开 Vite 提示的地址，使用 `.env` 中的账号密码登录。

### 3. Docker 部署

```powershell
.\rebuild.ps1           # 使用缓存构建并启动
.\rebuild.ps1 -NoCache  # 无缓存构建
```

访问 `http://localhost:5101` 进入控制台。

## MCP 接入

在支持 MCP 的客户端中按如下方式接入（`Bearer` 后填 `.env` 中的 `MCP_API_KEY`）：

```json
{
  "type": "streamableHttp",
  "url": "http://localhost:5101/mcp",
  "headers": {
    "Authorization": "Bearer xxx...."
  }
}
```

可用工具：

| 工具                    | 说明                                        |
| ----------------------- | ------------------------------------------- |
| `list_knowledge_bases`  | 列出全部知识库（id / 名称 / 描述 / 统计）   |
| `search_knowledge_base` | 在指定知识库中做稠密 + 稀疏混合检索         |

## 配置项（.env）

| 变量 | 默认 | 说明 |
| ---- | ---- | ---- |
| `APP_PORT` | 5101 | 服务监听端口 |
| `MCP_API_KEY` | — | MCP 端点 Bearer 密钥 |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | admin / — | 前端登录账号密码（唯一） |
| `AUTH_SECRET` | — | 登录令牌签名密钥 |
| `MAX_FILE_SIZE_MB` / `MAX_UPLOAD_COUNT` | 128 / 10 | 上传限制 |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | 512 / 50 | 分块设置 |
| `BATCH_SIZE` / `CONCURRENCY_LIMIT` / `MAX_RETRIES` | 32 / 3 / 3 | 批处理设置 |
| `RETRIEVAL_TOP_K` | 5 | 检索返回结果数 |
| `DENSE_TOP_K` / `SPARSE_TOP_K` | 50 / 50 | 混合检索召回数 |
| `EMBEDDING_BASE_URL` / `_API_KEY` / `_MODEL` / `_DIM` | — | 嵌入模型（亦可在前端配置） |

## 开发进度

见 [`.docs/BLUEPRINT.md`](.docs/BLUEPRINT.md)。当前里程碑 **M0 初始化与基础骨架** 已完成；
文档摄取管线、管理 UI 与混合检索将在 M1–M4 实现。

## License

AGPL-3.0 — 详见 [LICENSE](LICENSE)
