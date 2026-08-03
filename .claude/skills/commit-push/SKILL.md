# Skill: commit-push

## 描述

执行 Git 提交和推送操作。

## 前置条件

- 用户明确请求提交或推送
- 不得自动提交或自动推送

## 提交规范

- 格式：Conventional Commits（英文小写）
- 类型：`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `style:`, `init:`, `build:`
- 禁止添加 `Co-Authored-By` 行

## 步骤

1. `git status` 确认变更文件
2. `git add <file1> <file2> ...`（逐个显式添加，禁止 `-A` / `.` / `-u`）
3. 多行 commit message 使用 HEREDOC：
   ```powershell
   git commit -m @"
   <type>: <subject>

   <body>
   "@
   ```
4. `git -c credential.helper= -c "url.https://x-access-token:$GITHUB_PAT@github.com/.insteadOf=https://github.com/" push -u origin master`（首次）或 `git -c credential.helper= -c "url.https://x-access-token:$GITHUB_PAT@github.com/.insteadOf=https://github.com/" push origin master`（后续）

## GitHub 鉴权（MUST）

所有 `git push` / `gh` 操作必须通过 `$GITHUB_PAT` 鉴权。
`$GITHUB_PAT` 由 `H:\GitHub\.claude\settings.json` 的 `env` 段注入，无需手动设置。

禁止裸 `git push`（会走 DPAPI/Credential Manager → Session 0 报错）。

## 推送前二次确认

以下文件变更需要在推送前获得用户二次确认：
- `Dockerfile`
- `docker-compose.yml`
- `package-lock.json`
- 大量文件删除

## 禁止操作

- `git add -A` / `git add .` / `git add -u`
- `git push --force` / `--force-with-lease`
- `git commit --amend`（已推送的提交）
- `git rebase`
- `git config` 修改
- `git reset --hard`
- `--no-verify`
- 提交 `.env`、`node_modules/`、`dist/`、`*.log`、`.claude/settings.local.json`、>5MB 二进制
