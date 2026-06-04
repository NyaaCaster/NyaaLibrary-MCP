---
name: rebuild
description: Rebuild the NyaaLibrary-MCP Docker image and restart its container locally (no registry push). Use whenever the project needs a Docker rebuild + restart — after changes to Dockerfile, docker-compose.yml, .dockerignore, or any server/ or frontend/ source that ends up in the image. Runs rebuild.ps1 via PowerShell with -ExecutionPolicy Bypass.
---

# rebuild

需要重新构建镜像并重启本项目容器时调用此 skill。**本项目只在本地构建并运行容器，不打包推送到镜像仓库。**

## 触发场景

- 用户明确要求“重新构建”、“重建镜像”、“重启容器”、“部署”、“rebuild”。
- 改动了 `Dockerfile`、`docker-compose.yml`、`.dockerignore` 等容器构建相关文件。
- 改动了 `server/**`、`frontend/**`、`package.json` 等会进入镜像的源码 / 依赖。
- 通过 `/rebuild` 显式调用。

## 调用方式（Windows）

本项目为 Windows 开发环境，使用 `rebuild.ps1`，**必须**带 `-ExecutionPolicy Bypass`：

```powershell
powershell -ExecutionPolicy Bypass -File .\rebuild.ps1
```

用 `PowerShell` 工具直接执行；执行前确认工作目录为项目根目录（含 `docker-compose.yml`）。

### 关于 `-ExecutionPolicy Bypass`

该参数传给 PowerShell 进程本身（不是脚本参数），临时绕过本机脚本执行策略，仅对本次进程生效、不改注册表、不需要管理员权限。`rebuild.ps1` 是本仓库未签名脚本，在默认 `Restricted` 策略的机器上不加此参数会报 “running scripts is disabled on this system”。

## 脚本工序（已固化在 rebuild.ps1，勿手动重复）

`down` → `build` → 清理 dangling 镜像 → `up -d` → 列出运行容器。

- **`-p nyaalibrary-mcp` 锁定 compose 项目名**：本机同时运行着大量其它容器，项目名锁定确保 `down`/`up`/`build` 只作用于本项目，绝不波及他人。
- **直接构建运行、无镜像推送**：compose 用本地 tag `nyaalibrary-mcp:latest` 构建并 `up -d` 起容器即可，**不做** `docker tag` / `docker push` 到任何 registry。
- **数据持久化**：知识库数据落在绑定挂载 `./data`，`down`/重建不丢；只有删除 `./data` 才会重置。

## 缓存策略

脚本默认走 Docker 层缓存（不带 `--no-cache`）：

- 依赖安装层（`COPY package.json` + `npm install`）只要 lockfile/清单没变就命中缓存，秒级跳过；改源码只会让对应层失效，不会“该重建却没重建”。
- 首次或冷缓存构建会编译 `better-sqlite3` 原生模块；前端阶段已用 `npm_config_maxsockets=1` 串行下载规避 Docker Desktop 并发拉取卡死（约 8 分钟，属正常，后续走缓存即可）。

确需全量重建时，**临时手动加参数，不要改脚本**：

```powershell
docker compose -p nyaalibrary-mcp -f docker-compose.yml build --no-cache
docker compose -p nyaalibrary-mcp -f docker-compose.yml up -d
```

## 执行后汇报

简要告知：脚本是否成功、容器是否 Up、对外端口（`5106`，映射到容器内 `5101`）与访问地址（`http://localhost:5106`，MCP 端点 `/mcp`）。

## 不要做的事

- 不要绕过脚本直接散调 `docker compose build`/`up`/`down`——用脚本保证流程一致并锁定项目名。
- 不要省略 `-ExecutionPolicy Bypass`。
- 不要 `docker tag` / `docker push` 到 registry（本项目不需要）。
- 不要 `docker system prune -a`——脚本只清理 dangling 镜像，足够且安全。
- 不要随手删除 `./data`（会清空全部知识库）。
