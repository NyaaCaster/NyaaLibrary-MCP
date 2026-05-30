# Skill: rebuild

## 描述

构建并重启项目的 Docker 容器。

## 触发

用户请求构建、重启、部署本地容器时调用。

## 步骤

1. 执行 `.\rebuild.ps1`（默认使用缓存）
2. 如果用户要求无缓存构建，执行 `.\rebuild.ps1 -NoCache`
3. 确认容器状态正常

## 推送到私有仓库（可选）

如果用户要求推送镜像：

```powershell
docker tag nyaaframe:latest localhost:5000/nyaaframe:latest
docker push localhost:5000/nyaaframe:latest
```

## 注意事项

- 构建前确认 `docker-compose.yml` 和 `Dockerfile` 无语法错误
- 镜像体积目标 ≤ 40 MB
- 清理悬空镜像由脚本自动完成
