# 服务器管理

用于启动、停止和更新 GuardClaw 服务器的命令。

## start

启动 GuardClaw 服务器并在浏览器中打开控制面板。

```bash
guardclaw start [选项]
```

### 选项

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-f`, `--foreground` | 前台运行（Ctrl-C 停止） | 守护进程模式 |
| `--port <端口>` | 服务器端口 | `3002` |
| `--no-open` | 启动时不打开浏览器 | 自动打开 |
| `--no-onboarding` | 跳过首次配置向导（适用于 CI/脚本） | 运行向导 |
| `--openclaw-url <url>` | OpenClaw 网关 URL | 从 `.env` 读取 |
| `--openclaw-token <token>` | OpenClaw 网关 Token | 从 `.env` 读取 |
| `--anthropic-key <key>` | Anthropic API 密钥 | 从 `.env` 读取 |

旧版别名 `--clawdbot-url` 和 `--clawdbot-token` 同样有效。

### 守护进程模式（默认）

默认情况下，`guardclaw start` 以**后台守护进程**方式运行。进程脱离终端，关闭 shell 后继续运行。

```bash
guardclaw start
# ✅ GuardClaw running in background (PID 12345)
# 📜 Logs: .guardclaw/server.log
# 🛑 Stop with: guardclaw stop
```

- 日志写入当前目录的 `.guardclaw/server.log`
- 使用 `guardclaw stop` 终止服务器

### 前台模式

使用 `-f` 或 `--foreground` 在当前终端运行。按 Ctrl-C 停止。

```bash
guardclaw start -f
```

适用于开发、调试或在容器内运行。

### 首次配置向导

首次启动（无 `.env` 文件时），CLI 会运行 4 步交互式配置向导：

1. **评估模式** — 本地、混合或纯云端
2. **LLM 后端** — LM Studio、Ollama、内置或 Fallback（混合/云端模式还需选择云端提供商）
3. **响应模式** — 自动或仅监控
4. **Agent 连接** — 自动检测并连接已安装的 Agent

使用 `--no-onboarding` 跳过，或稍后运行 `guardclaw setup`。

### 工作目录

服务器在**当前工作目录**下运行。这意味着：

- `.env` 从当前目录读取
- `.guardclaw/` 数据目录（events.db、memory.db）创建在当前目录
- 每个项目可以拥有独立的 GuardClaw 配置和事件记录

### 示例

```bash
# 使用默认设置启动
guardclaw start

# 自定义端口，不打开浏览器
guardclaw start --port 4000 --no-open

# 前台模式调试
guardclaw start -f --port 3002

# 内联指定 OpenClaw Token
guardclaw start --openclaw-token eyJ...

# CI 环境无交互启动
guardclaw start --no-onboarding --no-open
```

## stop

停止运行中的 GuardClaw 服务器。

```bash
guardclaw stop
```

命令通过两种方式查找 GuardClaw 进程：

1. **进程表扫描** — 搜索 `ps ax` 中运行 `server/index.js` 且包含 "guardclaw" 的进程
2. **端口监听扫描** — 查找监听 GuardClaw 端口（默认 3002）的 `server/index.js` 进程

所有匹配的进程使用 `SIGKILL` 终止。

```bash
guardclaw stop
# 🛑 Stopping GuardClaw...
# ✅ Stopped PID 12345
# ✅ Stopped 1 process(es)
```

## restart

停止服务器并重新启动。接受与 [`start`](#start) 相同的所有选项。

```bash
guardclaw restart [选项]
```

别名：`rs`、`r`

```bash
# 快速重启
guardclaw rs

# 使用不同端口重启
guardclaw restart --port 4000
```

## status

显示运行中服务器的综合状态。

```bash
guardclaw status
```

输出包括：

- **运行状态** — 服务器进程 PID
- **阻断** — 是否启用执行前阻断
- **失败关闭** — LLM 不可用时是否阻断工具调用
- **LLM** — 当前后端和加载的模型
- **Agent 连接** — 每个已连接的 Agent 及事件计数
- **事件** — 总数、安全、警告和已阻断计数
- **缓存** — 命中、未命中和 AI 调用次数

::: tip
`guardclaw status` 需要服务器正在运行。如果服务器离线，将打印错误信息并退出。
:::

## update

从 npm 更新 GuardClaw 到最新版本。

```bash
guardclaw update
```

别名：`upgrade`

命令执行步骤：

1. 检查当前版本与 npm 上的最新版本
2. 如已是最新，打印消息并退出
3. 停止运行中的服务器（如有）
4. 运行 `npm install -g guardclaw@latest`
5. 如果更新前服务器在运行，则重新启动

## version

打印已安装的版本号。

```bash
guardclaw version
guardclaw --version
guardclaw -v
```
