# NyaaLibrary-MCP V2 前端显示改造 — 开发计划 SSOT

> 本文件是本次改造的唯一事实来源（SSOT）。目标：让 5114 前端管理台能看到、维护猫猫自主沉淀的**记忆条目**与**用户画像**。

---

## 1. 背景与根因

### 1.1 现状确诊（已在 macmini 实例上验证）

macmini 运行实例 `nyaalibrary-mcp`（5114→5101），数据库 `/root/DockerContainer/DockerRes/nyaalibrary-mcp/data/library.db`，只读探查结果：

| 表 | 行数 | 说明 |
| --- | --- | --- |
| `memory_entries` | 1 | 猫猫沉淀，`owner_key=247408926`，`mem_fts` 同步 1 行 |
| `profiles` | 0 | 画像尚未产生过 |
| `knowledge_bases` / `documents` / `chunks` | 0 | 全空 |
| `settings` | 1 键 | `mem_vec_dim=1536` |

### 1.2 根因

服务内部存在**两条互不相通的存储链路**：

| 链路 | 写入方 | 端点 | 鉴权 | 落表 | 组织维度 |
| --- | --- | --- | --- | --- | --- |
| **知识库**（M0–M4） | 管理员/人 | `/api/kb`、`/api/kb/:id/documents` … | 管理员登录 HMAC 令牌（`requireSession`） | `knowledge_bases → documents → chunks` | `kb_id` |
| **自主记忆**（智能框架 P6+） | 猫猫（机器） | `/api/memory/*` | 成对 token：`KB_SERVER_TOKEN` + `X-Sender-Id`（`requireMemoryAuth` + `requireSenderId`，fail-closed） | `memory_entries` / `profiles` | `owner_key` / `sender_id` |

5114 前端是 M0–M4 时期产物，**整套 UI 只渲染知识库链路**（`App.tsx` 只有 `/` 与 `/kb/:id` 两个路由）。后期新增记忆链路时，前端从未补上对应运维界面。于是：数据在库里，但前端去列 `knowledge_bases`（恰好空表），页面一片空白。

**这不是数据丢失或 bug，是前端缺失了对记忆链路的展示与维护入口。**

### 1.3 关键前提（背景，本次不处理）

向量检索依赖使用者自行配置嵌入模型，且该配置是否曾正确运行**未经验证**。补充写入记忆会走 `embedMany`，若嵌入配置缺失/错误将抛错。本次改造仅需**如实透传该错误到前端**，不负责修复嵌入配置本身。

### 1.4 决策记录（2026-07-18 用户拍板，来自《设计审核报告.md》三决策点）

| # | 决策点 | 结论 | 落地影响 |
| --- | --- | --- | --- |
| **D1** | 补充上传时嵌入维度与已建 `vec_mem` 不一致怎么办 | **前端/服务维度保持一致**：前端补充上传不引入独立维度概念，直接复用服务端当前嵌入配置，维度单一来源 | 正常路径下当前维度 == `mem_vec_dim`，`ensureMemVecTable` 命中 `current === dim` 直接返回，**不触发 DROP 重建**；后端补充写入前显式比对维度，不一致则**拒写并透传错误**，绝不静默重建清空猫猫向量（见 §4.2） |
| **D2** | 「补充上传」记忆条目的形态 | **文本录入单条** | `MemoryCreateModal` 为多行文本框录入一条，非文件拖放（贴合 `memory_entries.content` 单条文本形态，见 §5.1） |
| **D3** | 用户画像的编辑能力 | **整条增改 + 整条删** | 编辑走 `upsertProfile` 字段级 merge（整条覆盖），删除走整条 `DELETE`；**不做删单个键**，留 V3（见 §5.5） |

---

## 2. 目标与范围边界

### 2.1 目标

前端管理台可以：

1. **看到**猫猫记录的记忆条目内容与用户画像；
2. **补充上传**记忆条目；
3. **删除**记忆条目、删除用户画像；
4. 条目内容的**查看、删除**尽量复用现有 UI 交互逻辑。

### 2.2 范围内（IN）

- 后端新增一组走 `requireSession`（管理员鉴权）、可**跨 owner** 浏览/写入/删除的运维端点，全部落**新文件**（`services/adminMemory.ts` + `routes/owners.ts`）。
- 新 service 能力（owner 聚合、按 owner 列记忆、**按 id 精确删记忆**、删画像）一律写在**新文件** `services/adminMemory.ts`，只读 `import` 复用猫猫链路的现有函数，不改其函数体。
- 前端新增：顶栏导航、owner 列表页、owner 详情页（记忆条目 tab + 用户画像 tab）。前端全面**将就现有后端形态**，不为迁就前端而改动既有后端逻辑。

### 2.3 范围外（OUT，用户明确排除）

- ❌ 记忆库/owner 的重命名、描述编辑
- ❌ 启用/禁用开关
- ❌ 修改 `/api/memory/*` 机器链路（猫猫写入路径保持不动）
- ❌ 嵌入配置的验证与修复（见 §1.3）
- ❌ 记忆检索测试 UI（非本次诉求；如需可后续追加）

### 2.4 后端改动红线（MUST · 最高优先级）

> **原则：禁止修改任何已在正常使用的后端；所有功能设计由前端将就后端。目的是杜绝改动后端导致猫猫无法再有效写入数据。**

- **字节级不变清单**（猫猫写入/读取链路依赖，本次一律不得改动）：
  - `server/src/services/memory.ts`（`writeMemory` / `upsertProfile` / `getProfile` / `searchMemory` / `forgetMemories`）
  - `server/src/routes/memory.ts`（`/api/memory/*` 端点）
  - `server/src/auth/memory.ts`（成对 token 鉴权）
  - `server/src/db/index.ts`（schema / 迁移 / 向量表懒建）
- **允许的后端改动仅两项**，且均为纯增量、物理上碰不到上述文件的行为：
  1. 新增文件 `server/src/services/adminMemory.ts` 与 `server/src/routes/owners.ts`；
  2. 在 `server/src/routes/index.ts` 的 `requireSession` 之后**追加一行** `api.use("/owners", ownersRouter)`（挂载新前缀，不改任何既有 `api.use`）。
- 新 service 通过 `import` 复用 `writeMemory` / `upsertProfile` / `getProfile` —— import 不等于修改，被复用函数的实现保持原样。
- **维度一致守卫（D1）不得写进 `writeMemory` 内部**（那会改到猫猫用的文件），只能落在 `adminMemory.ts` / `routes/owners.ts` 的调用前置检查（见 §4.2）。

---

## 3. 架构方案

### 3.1 数据组织：以 owner 为一级维度

记忆条目（`memory_entries.owner_key`）与画像（`profiles.sender_id`）本质是同一把 owner 键。前端按 **owner** 组织成两级结构，与现有「知识库列表 → 知识库详情」同构：

```
一级：owner 列表      ← 对标 KnowledgeBasesPage（卡片列表）
  每张卡片：nickname / owner_key、记忆条数、是否有画像
二级：owner 详情       ← 对标 KbDetailPage（tab 切换）
  ├─ Tab「记忆条目」  ← 对标 DocumentsTab（搜索 + 分页 + 表格）+ 补充 + 查看/删除
  └─ Tab「用户画像」  ← 画像键值渲染 + 编辑 + 删除
```

### 3.2 鉴权隔离（安全红线）

- 新运维端点一律挂在 `requireSession` **之后**，走管理员 HMAC 令牌，与猫猫的成对 token 链路**完全隔离**。
- 猫猫链路 `/api/memory/*` 保持挂在 `requireSession` 之前、用自己的 fail-closed 成对 token，**本次不改动**。
- 前端复用现有 `api`（自动带 `Authorization: Bearer <管理员令牌>`），无需接触 `KB_SERVER_TOKEN`。

### 3.3 越权防护（F1 修正 · 承重逻辑）

> ⚠️ 审核发现并已修正：`vec_mem` / `mem_fts` 是 sqlite-vec / FTS5 虚表，**只有 rowid，没有 `owner_key` 列**（见 `db/index.ts`）。因此「三表统一按 `WHERE id=? AND owner_key=?` 删除」在物理上不成立——只有 `memory_entries` 才有 `owner_key`。

正确的删除次序（`deleteMemoryById` 必须照此实现）：

1. 先删 `memory_entries`：`DELETE FROM memory_entries WHERE id = ? AND owner_key = ?`，取 `changes`（命中行数）。
2. **命中行数为 0**（id 不存在 / owner 不匹配）→ 事务内 `return false`，**绝不触碰** `vec_mem` / `mem_fts`。这就是越权防护落点。
3. 命中行数为 1 → 才按同一 rowid 级联删 `vec_mem`（`memVecTableExists()` 守卫，懒建）与 `mem_fts`。

即：owner 校验只能落在 `memory_entries` 这一步，另两表的删除是「已确认归属后」的 rowid 级联，不是独立的 owner 过滤。

---

## 4. 后端设计

### 4.1 新增 service 能力（**新文件** `server/src/services/adminMemory.ts`）

> ⚠️ 红线（§2.4）：这些函数**不得**写进猫猫在用的 `services/memory.ts`，必须落在独立新文件 `adminMemory.ts`。文件顶部 `import { writeMemory, upsertProfile, getProfile } from "./memory.js"` 只读复用，被复用函数实现保持原样。DB 句柄与 `memVecTableExists` 从 `db/index.ts` 只读 `import`。

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `listOwners()` | `() => OwnerSummary[]` | 聚合 `memory_entries` + `profiles`，返回每个 owner 的 `{ owner_key, nickname, memory_count, has_profile }` |
| `listMemoryByOwner(ownerKey)` | `(string) => MemoryEntryRow[]` | 列该 owner 全部记忆条目（不含向量），按 `created_at` 倒序 |
| `deleteMemoryById(ownerKey, id)` | `(string, number) => boolean` | **新增精确删除**：事务内先 `DELETE FROM memory_entries WHERE id=? AND owner_key=?`，命中行数=0 直接返回 false（越权防护，见 §3.3）；命中才按 rowid 级联删 `vec_mem`（懒建守卫）+ `mem_fts`。返回是否命中 |
| `deleteProfile(ownerKey)` | `(string) => boolean` | 删 `profiles` 行 |
| `dimensionInSync()` | `() => boolean` | D1 前置守卫：比对 `getEmbeddingSettings().dim` 与 `getMemVecDim()`，用于补充上传前判断，避免触发 `writeMemory` 内的 DROP 重建（见 §4.2）。均从 `settings`/`db` 只读 |

> 复用现有 `writeMemory`（补充上传）、`upsertProfile`（画像编辑）、`getProfile`（画像读取）——**只 import，不改**。
> 注意：现有 `forgetMemories` 是按 hint（FTS MATCH）模糊删，**不复用**——运维删除必须按 id 精确。
> `listOwners` / `listMemoryByOwner` / `deleteMemoryById` / `deleteProfile` 的 SQL 均在 `adminMemory.ts` 内用只读 import 的 `db` 句柄执行，不新增/修改任何表结构。

**`listOwners()` 聚合 SQL（主选 FULL OUTER JOIN，SQLite ≥3.39）：**

```sql
SELECT
  COALESCE(m.owner_key, p.sender_id) AS owner_key,
  COALESCE(p.nickname, '')           AS nickname,
  COALESCE(m.cnt, 0)                 AS memory_count,
  CASE WHEN p.sender_id IS NOT NULL THEN 1 ELSE 0 END AS has_profile
FROM (SELECT owner_key, COUNT(*) AS cnt FROM memory_entries GROUP BY owner_key) m
FULL OUTER JOIN profiles p ON m.owner_key = p.sender_id
ORDER BY memory_count DESC;
```

> 兜底（若运行时 SQLite 不支持 FULL OUTER JOIN）：用 `memory_entries GROUP BY` 与 `profiles` 两段 `UNION`，profiles 段加 `WHERE sender_id NOT IN (SELECT owner_key FROM memory_entries)`。P1 落地时以实际 `better-sqlite3` 携带版本为准，二选一。

`deleteMemoryById` 事务须处理 `vec_mem` 懒建（用 `memVecTableExists()` 守卫，与 `forgetMemories` 一致）。

### 4.2 新增运维路由（`server/src/routes/owners.ts`，走 `requireSession`）

统一前缀 `/api/owners`。`:ownerKey` 在 URL 中做 `encodeURIComponent`（owner 键可能非纯数字）。

| 方法 | 路径 | 入参 | 响应 | 复用/新增 |
| --- | --- | --- | --- | --- |
| GET | `/api/owners` | — | `OwnerSummary[]` | `listOwners`（新） |
| GET | `/api/owners/:ownerKey/memory` | — | `MemoryEntryRow[]` | `listMemoryByOwner`（新） |
| POST | `/api/owners/:ownerKey/memory` | `{ content, salience? }` | `201 { id, chunk_count }` | `writeMemory`（复用） |
| DELETE | `/api/owners/:ownerKey/memory/:id` | — | `204` / `404` | `deleteMemoryById`（新） |
| GET | `/api/owners/:ownerKey/profile` | — | `ProfileRow` / `404` | `getProfile`（复用） |
| PUT | `/api/owners/:ownerKey/profile` | `{ nickname?, profile_patch? }` | `ProfileRow` | `upsertProfile`（复用） |
| DELETE | `/api/owners/:ownerKey/profile` | — | `204` / `404` | `deleteProfile`（新） |

- POST memory：`content` 非空字符串校验；`writeMemory` 抛「尚未配置嵌入维度」等错误时透传 `500 + { error }`，前端展示原文。
- **维度一致守卫（决策 D1）**：补充上传**不引入任何前端独立的嵌入维度/模型配置**，一律复用服务端当前 `settings` 中生效的嵌入配置，维度为单一来源。写入前若「当前配置维度」与「已建向量表维度 `mem_vec_dim`」不一致，**直接拒写并透传中文错误**（`409`/`500 + { error }`），**绝不静默 DROP 重建 `vec_mem`**（避免清空猫猫已沉淀向量）。正常路径（配置未变）下维度天然一致，`ensureMemVecTable` 命中 `current === dim` 直接返回、不触发重建。
  - 实现方式：`writeMemory` 前置一道维度比对（`getEmbeddingSettings().dim` vs `getMemVecDim()`），不一致 fail-fast；或在 owner 路由层调用 `writeMemory` 前显式校验。P1/P2 落地时择一，但**必须**保证补充上传不会触发既有 `ensureMemVecTable` 的 DROP 分支。
- 路由挂载：在 `server/src/routes/index.ts` 的 `requireSession` 之后 `api.use("/owners", ownersRouter)`。
- 入参校验沿用 `zod`（对标 `routes/kb.ts`）。

### 4.3 后端类型

```ts
export interface OwnerSummary {
  owner_key: string;
  nickname: string;
  memory_count: number;
  has_profile: number; // 0 | 1
}
export interface MemoryEntryRow {
  id: number;
  owner_key: string;
  content: string;
  char_count: number;
  salience: number;
  created_at: string;
}
```

---

## 5. 前端设计

### 5.1 复用映射（核心：尽量复刻现有交互）

| 新界面 | 复用来源 | 复用点 |
| --- | --- | --- |
| owner 列表页 `OwnersPage` | `KnowledgeBasesPage` | 卡片网格布局、加载/空态、`useQuery` |
| owner 详情页 `OwnerDetailPage` | `KbDetailPage` | 返回链接、`-mb-px` 下划线 tab、`useParams` |
| 记忆条目 Tab `MemoryTab` | `DocumentsTab` | 顶部「补充记忆」按钮 + 搜索框 + 取消筛选 X、`Pagination`、`useSort`、空/加载态、表格 |
| 记忆查看+删除弹窗 `MemoryDetailModal` | `ChunkDetailModal` | `Modal` 外壳、readonly `textarea` 显示内容、**内联确认删除**（「确认删除？取消/确认」+ spinner） |
| 补充记忆弹窗 `MemoryCreateModal` | `Modal` + `input`/`btn` | 多行文本录入 + 可选 salience + 提交（**文本录入，非文件拖放**，因 `memory_entries.content` 是文本） |
| 用户画像 Tab `ProfileTab` | `Modal` + `KbDetailPage` 的 Overview 卡片 | 画像键值对渲染、编辑弹窗（`textarea` 编辑 JSON / nickname）、内联确认删除 |
| 全局 | `Modal`/`btn`/`input`、`Pagination`、`useSort`、`formatDateTime`、`api` | 直接引用 |

### 5.2 路由与导航

- `App.tsx` 新增：`/owners`（列表）、`/owners/:ownerKey`（详情）。
- `AppShell.tsx` 顶栏加导航：「知识库」(`/`) 与「猫猫记忆」(`/owners`)，当前路由高亮（indigo）。图标用 `lucide-react`（如 `Brain`/`Library`）。

### 5.3 API 层扩展（`frontend/src/lib/api.ts`）

新增类型 `OwnerSummary` / `MemoryEntryRow` / `ProfileRow`，及调用（复用 `api.get/post/put/del`，路径参数 `encodeURIComponent(ownerKey)`）。

### 5.4 记忆条目 Tab 行为细节

- 拉取：`GET /api/owners/:ownerKey/memory` 全量，前端 `useSort` + `Pagination` 分页（`PAGE_SIZE=10`，对标 `DocumentsTab`）。
  - 已知限制：单 owner 记忆量极大时全量拉取偏重；本次对标现有文档页的全量策略保持一致，服务端分页留作后续优化。
- 列：内容摘要（单行截断）/ 字符数 / salience / 创建时间；行「查看」进 `MemoryDetailModal`。
- 搜索：前端按 `content` 过滤（对标 `DocumentsTab` 的 `name` 过滤）。
- 删除：`MemoryDetailModal` 内内联确认 → `DELETE …/memory/:id` → 失效 `["owner-memory", ownerKey]` 与 `["owners"]` 查询。
- 补充：`MemoryCreateModal` 提交 `POST …/memory`；成功刷新列表，失败（含嵌入未配置）在弹窗内红字提示 `error` 原文。

### 5.5 用户画像 Tab 行为细节

- 拉取：`GET …/profile`，404 时显示空态「该 owner 暂无画像」+「新建画像」。
- 展示：`nickname` + `profile_json` 解析为键值对卡片渲染。
- 编辑（决策 D3：整条增改）：弹窗内改 `nickname`，`profile_json` 用 `textarea` 编辑（提交前 `JSON.parse` 校验，非法则红字拦截）→ `PUT …/profile`。
  - ⚠️ `upsertProfile` 是**字段级 merge**（`{...old, ...patch}`），无法删单个键。因此编辑弹窗须把当前 `profile_json` 完整回填进 `textarea`，管理员在此基础上增改；提交的 `profile_patch` 是**编辑后的完整对象**，靠 merge 覆盖旧值。UI 文案明确「编辑即整条覆盖，删单个键请删整条画像后重建」。
- 删除（决策 D3：整条删）：内联确认 → `DELETE …/profile`，删除整条画像。**本次不做单键删除**（留 V3）。

---

## 6. 版本与阶段划分（V2）

状态：⬜ 未开始 / 🟡 进行中 / ✅ 已完成

| P | 阶段 | 内容 | 交付物 | 状态 |
| --- | --- | --- | --- | --- |
| P1 | 后端 service | `listOwners` / `listMemoryByOwner` / `deleteMemoryById` / `deleteProfile` + 类型 | `services/adminMemory.ts` | ✅ |
| P2 | 后端路由 | `routes/owners.ts`（7 端点，`requireSession`，zod 校验，错误透传）+ 挂载 | `routes/owners.ts`、`routes/index.ts` | ✅ |
| P3 | 前端 API 层 | 类型 + 调用函数 | `lib/api.ts` | ✅ |
| P4 | 前端导航+列表 | `AppShell` 导航、`OwnersPage`、路由 | `AppShell.tsx`、`OwnersPage.tsx`、`App.tsx` | ✅ |
| P5 | 记忆条目 Tab | `OwnerDetailPage`、`MemoryTab`、`MemoryDetailModal`、`MemoryCreateModal` | 对应组件 | ⬜ |
| P6 | 用户画像 Tab | `ProfileTab` + 编辑/删除弹窗 | `ProfileTab.tsx` | ⬜ |
| P7 | 端到端验证+部署 | 本地 build/typecheck → rebuild 推送 → macmini restart → 真机 E2E → 清理 | 验证记录 | ⬜ |

每个 P 可独立验证、独立提交。

---

## 7. 验证清单

### 后端（P1–P2）

- [ ] `GET /api/owners` 返回含 `247408926`（memory_count=1, has_profile=0）
- [ ] `GET /api/owners/247408926/memory` 返回 1 条，含「一个 bug 叫 bug…」
- [ ] `POST /api/owners/<owner>/memory` 写入成功（嵌入就绪时）；嵌入未配置时 500 + 中文错误原文
- [ ] `DELETE /api/owners/<owner>/memory/:id` 后三表（`memory_entries`/`vec_mem`/`mem_fts`）均无残留
- [ ] 越权校验：删除时 `owner_key` 不匹配返回 404，不误删
- [ ] `PUT/GET/DELETE …/profile` 读写删闭环
- [ ] 未登录（无管理员令牌）访问 `/api/owners/*` 返回 401

### 前端（P3–P6）

- [ ] 顶栏「猫猫记忆」入口可达，列表显示 owner 卡片
- [ ] 记忆条目列表：搜索、分页、排序、查看弹窗、内联删除均正常
- [ ] 补充记忆：成功刷新；失败展示错误原文
- [ ] 画像：无画像空态、编辑（JSON 非法拦截）、删除闭环
- [ ] `npm run build` 与 typecheck 通过；代码签名三处不受影响

### 部署（P7）

- [ ] macmini restart 后新界面可用，猫猫历史记忆可见
- [ ] 测试数据清理（删除验证期写入的记忆/画像，恢复到测试前）
- [ ] `git status` 无意外残留

---

## 8. 环境变量（无新增）

复用现有：管理员 `AUTH_USERNAME`/`AUTH_PASSWORD`/`AUTH_SECRET`、机器链路 `KB_SERVER_TOKEN`（不改）、嵌入设置（DB `settings`）。本次改造**不引入新环境变量**。

---

## 9. 风险与已知限制

| 风险 | 说明 | 应对 |
| --- | --- | --- |
| 嵌入配置存疑 | 补充写入依赖 `embedMany`，配置未验证（§1.3） | 透传错误原文，不在本次修复；查看/删除已有记忆不受影响 |
| 单 owner 记忆量大 | 前端全量拉取分页 | 对标现有文档页策略；标注为后续服务端分页优化点 |
| FULL OUTER JOIN 兼容 | 依赖 SQLite ≥3.39 | P1 按实际版本二选一（JOIN / UNION 兜底） |
| WAL 未合并 | 探查时见 6.3M WAL | 只读查询无影响；部署 restart 会正常收尾 |

---

## 10. 参考落点

- 后端：`server/src/services/memory.ts`、`server/src/routes/{index,owners}.ts`、`server/src/auth/{memory,session}.ts`
- 前端复用样板：`frontend/src/pages/{KnowledgeBasesPage,KbDetailPage}.tsx`、`frontend/src/pages/kb/{DocumentsTab,ChunkDetailModal}.tsx`、`frontend/src/components/{Modal,Pagination,AppShell}.tsx`
- 数据库：macmini `/root/DockerContainer/DockerRes/nyaalibrary-mcp/data/library.db`
```
