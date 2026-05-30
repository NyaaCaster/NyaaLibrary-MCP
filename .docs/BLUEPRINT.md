# NyaaLibrary-MCP 开发任务蓝图

> 用于 LLM 聊天知识库的 MCP（内置前端管理页面）。检索增强（RAG）知识库 + 现代化管理控制台。

## 里程碑状态

| #  | 里程碑                 | 状态 | 完成日期   |
| -- | ---------------------- | ---- | ---------- |
| M0 | 初始化与基础骨架       | ✅   | 2026-05-31 |
| M1 | 文档摄取管线           | ✅   | 2026-05-31 |
| M2 | 知识库与文档管理 UI    | ✅   | 2026-05-31 |
| M3 | 检索与嵌入配置         | ✅   | 2026-05-31 |
| M4 | 打磨与部署             | ✅   | 2026-05-31 |

---

## M0 — 初始化与基础骨架 ✅ _完成于 2026-05-31_

- [x] 基于 NyaaFrame 模板初始化（meta.json / LICENSE / README）
- [x] 目录重构为 fullstack monorepo（`frontend/` + `server/`，npm workspaces）
- [x] 后端骨架：Express + MCP（`/mcp` Streamable HTTP + SSE，Bearer 鉴权，镜像 NyaaChat-MCP）
- [x] 双鉴权：MCP API Key（`MCP_API_KEY`）+ 管理登录令牌（账号密码自 `.env`，HMAC 令牌）
- [x] SQLite 数据层：schema（knowledge_bases / documents / chunks / settings）+ sqlite-vec 稠密虚表（懒建）+ FTS5 稀疏表
- [x] 知识库 CRUD（REST `/api/kb`）+ 统计（文档数 / 分块数）
- [x] 混合检索骨架（稠密 KNN + 稀疏 BM25 + RRF）与嵌入接口（OpenAI 兼容 / 维度自动获取）
- [x] MCP 工具：`list_knowledge_bases`、`search_knowledge_base`
- [x] 前端骨架：登录页、AppShell（主题切换 淡/深/系统、退出登录）、知识库列表页（增删改查）、响应式
- [x] 嵌入模型设置页（已联通后端：保存 / 自动获取维度）
- [x] 单容器多阶段 Dockerfile + docker-compose（端口 5101，挂载 ./data）
- [x] README（含 MCP 接入样例）+ BLUEPRINT + CLAUDE.md
- [x] 代码签名三处运行时可见（html `data-blessing` / 前端 `console.log` / 后端启动日志）
- [x] 可 `npm run build` 与本地运行
- [x] Git 初始化与首次推送

---

## M1 — 文档摄取管线 ✅ _完成于 2026-05-31_

- [x] 文件上传：multer（memoryStorage），校验大小（`MAX_FILE_SIZE_MB`）与数量（`MAX_UPLOAD_COUNT`）、扩展名白名单、非 ASCII 文件名 UTF-8 解码
- [x] 解析器：`.txt` / `.md`（原生）、`.pdf`（pdf-parse）、`.docx`（mammoth）、`.epub`（adm-zip + OPF spine）、`.xls` / `.xlsx`（SheetJS xlsx，CDN 版）
- [x] 分块：按 `chunk_size` 切分、`chunk_overlap` 重叠（`services/chunk.ts`）
- [x] 嵌入：OpenAI 兼容 `/embeddings`，批处理（`BATCH_SIZE`）、并发限制（`CONCURRENCY_LIMIT`，p-limit）、失败重试（`MAX_RETRIES`，退避）
- [x] 落库：事务写入 `chunks` + `vec_chunks`（稠密，rowid 以 BigInt 绑定）+ `chunks_fts`（稀疏），更新文档分块数；嵌入先于事务，保证全有或全无
- [x] 上传逐文件成功/失败反馈（multipart `files`，多文件）
- [x] 修复 sqlite-vec KNN：`k = ?` 约束 + CTE，先 KNN 再 join 过滤 kb_id
- [x] 端到端验证：上传（txt/md/docx/xlsx/epub）→ 分块 → 嵌入 → 检索（/api 与 MCP）→ 级联删除

---

## M2 — 知识库与文档管理 UI ✅ _完成于 2026-05-31_

- [x] 后端辅助：`GET /api/config` 暴露预设；上传路由接受 `chunk_size`/`chunk_overlap` 覆盖
- [x] 可复用组件：分页（首/上/下/尾 + 位置计数）、文件格式图标、可排序表头、客户端排序 hook
- [x] 文档管理标签页：上传按钮、搜索过滤栏 + 取消筛选、可排序分页表（名称/格式/大小/分块数/上传时间）
- [x] 上传界面：拖放 / 点击置入区、格式与大小/数量提示、分块设置（可改）、批处理设置（服务端预设只读）、逐文件结果
- [x] 文档详情弹窗：文档信息 + 分块列表（分页、单行截断）
- [x] 分块详情弹窗：序号 / 字符数 / 向量 ID / 多行内容 + 删除分块
- [x] 删除文档（确认）
- [x] 验证：`/api/config`、分块覆盖（200→6 块）、静态 SPA 托管（static=on，fallback 200）；前端 build/typecheck 通过

---

## M3 — 检索与嵌入配置 ✅ _完成于 2026-05-31_

- [x] 知识库检索 UI：多行检索输入、返回结果数量设置（默认取 `/api/config`）、检索按钮
- [x] 检索结果展示：结果编号 / 文本块编号 / 所属文档名 / 字符数 / 相关度分数 / 多行内容（带滚动）
- [x] 知识库设置：基本设置（分块大小、分块重叠）+ 检索设置（稠密 / 稀疏检索数量）+ 保存（PATCH `/kb/:id`）
- [x] 嵌入模型设置页打磨：Base URL / Key / 模型 / 维度自动获取，维度变更重建向量库提示
- [x] 验证：检索结果结构、设置持久化（chunk/dense/sparse + updated_at）；前端 build/typecheck 通过

---

## M4 — 打磨与部署 ✅ _完成于 2026-05-31_

- [x] 响应式细化：知识库卡片操作按钮触屏可见（移动端常显，桌面悬停）、详情标签横向滚动
- [x] 加载 / 错误 / 空态复核（各页面 spinner、错误提示、空占位齐备）
- [x] 修复 Docker 前端构建卡死：`npm_config_maxsockets=1` 串行下载（Docker Desktop 并发下载原生二进制会卡死）
- [x] Docker 部署验证：镜像构建（273MB，node:20-slim）→ 容器运行 → `/health`、登录、`/mcp`、静态 SPA 托管
- [x] 数据持久化与重启恢复验证（命名卷，重启后知识库仍在）
- [x] README 部署 / 持久化说明完善
- [ ] 镜像推送私有仓库（按用户选择暂跳过，部署用 `rebuild.ps1` 本地构建）

> 镜像推送为可选项；当前以本地构建（`rebuild.ps1` / `docker compose`）方式部署，端口 5101、数据落地 `./data`。

---

## 变更日志

| 日期       | 里程碑 | 变更内容                                                   |
| ---------- | ------ | ---------------------------------------------------------- |
| 2026-05-31 | M0     | 项目初始化、monorepo 重构、后端骨架、前端骨架、Docker、首次推送 |
| 2026-05-31 | M1     | 文档摄取管线：上传/解析(txt/md/pdf/docx/epub/xls/xlsx)/分块/嵌入/落库，混合检索打通 |
| 2026-05-31 | M2     | 文档管理 UI：上传界面、搜索过滤、可排序分页表、文档/分块详情、删除；config 接口 |
| 2026-05-31 | M3     | 检索测试 UI（相关度分数）、知识库设置（分块/稠密/稀疏）、嵌入设置打磨 |
| 2026-05-31 | M4     | 响应式打磨、Docker 构建修复（串行下载）、部署与持久化验证、文档完善 |
