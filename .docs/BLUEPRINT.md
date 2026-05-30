# NyaaLibrary-MCP 开发任务蓝图

> 用于 LLM 聊天知识库的 MCP（内置前端管理页面）。检索增强（RAG）知识库 + 现代化管理控制台。

## 里程碑状态

| #  | 里程碑                 | 状态 | 完成日期   |
| -- | ---------------------- | ---- | ---------- |
| M0 | 初始化与基础骨架       | ✅   | 2026-05-31 |
| M1 | 文档摄取管线           | 🟡   | —          |
| M2 | 知识库与文档管理 UI    | ⬜   | —          |
| M3 | 检索与嵌入配置         | ⬜   | —          |
| M4 | 打磨与部署             | ⬜   | —          |

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

## M1 — 文档摄取管线 🟡

- [ ] 文件上传：multer，校验大小（`MAX_FILE_SIZE_MB`）与数量（`MAX_UPLOAD_COUNT`）、扩展名白名单
- [ ] 解析器：`.txt` / `.md`（原生）、`.pdf`（pdf-parse）、`.docx`（mammoth）、`.epub`、`.xls` / `.xlsx`（xlsx）
- [ ] 分块：按 `chunk_size` 切分、`chunk_overlap` 重叠
- [ ] 嵌入：OpenAI 兼容 `/embeddings`，批处理（`BATCH_SIZE`）、并发限制（`CONCURRENCY_LIMIT`）、失败重试（`MAX_RETRIES`）
- [ ] 落库：写入 `chunks` + `vec_chunks`（稠密）+ `chunks_fts`（稀疏），更新文档分块数
- [ ] 上传进度 / 错误反馈

---

## M2 — 知识库与文档管理 UI ⬜

- [ ] 知识库详情：概述（基本信息 + 统计）已有，补充完善
- [ ] 文档管理：上传界面（拖放区、分块设置、批处理设置）
- [ ] 文档搜索过滤栏（模糊匹配）+ 取消筛选
- [ ] 文档列表表格：可排序列（名称 / 格式 / 大小 / 分块数 / 时间）、分页（每页 10、首/上/下/尾页、位置计数）、格式 svg 图标
- [ ] 文档详情：文档信息 + 分块列表（分页、单行截断、字符数、查看分块）
- [ ] 分块详情：序号 / 字符数 / 向量 ID / 多行内容、删除分块
- [ ] 删除文档（确认）

---

## M3 — 检索与嵌入配置 ⬜

- [ ] 知识库检索 UI：多行检索输入、返回结果数设置、检索按钮
- [ ] 检索结果展示：编号 / 文本块编号 / 所属文档 / 字符数 / 相关度分数 / 内容
- [ ] 知识库设置：分块大小、分块重叠、稠密检索数、稀疏检索数、保存
- [ ] 嵌入模型设置页打磨（已联通：Base URL / Key / 模型 / 维度自动获取）
- [ ] 检索质量校验（稠密 + 稀疏融合排序）

---

## M4 — 打磨与部署 ⬜

- [ ] 响应式细化（PC 横屏 / 手机竖屏）
- [ ] 全局加载态 / 错误态 / 空态
- [ ] Docker 部署验证（数据持久化、重启恢复）
- [ ] 镜像推送私有仓库
- [ ] 文档完善与发版

---

## 变更日志

| 日期       | 里程碑 | 变更内容                                                   |
| ---------- | ------ | ---------------------------------------------------------- |
| 2026-05-31 | M0     | 项目初始化、monorepo 重构、后端骨架、前端骨架、Docker、首次推送 |
