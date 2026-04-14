# Hook 集成

`guardclaw hooks` 命令管理 AI 编码 Agent 的 Hook 安装。Hook 拦截 Agent 的工具调用并发送到 GuardClaw 进行风险评估。

```bash
guardclaw hooks [install|uninstall] [agent]
```

## 查看状态

```bash
guardclaw hooks
```

显示所有支持的 Agent 的安装状态：

```
⛨  Hook Integrations

  ✅ Claude Code    installed
  ⚪ Codex          not installed
  —  Gemini CLI     not detected

  guardclaw hooks install [claude-code|codex|all]
  guardclaw hooks uninstall [claude-code|codex|all]
```

状态图标：

| 图标 | 含义 |
|------|------|
| ✅ | Hook 已安装且生效 |
| ⚪ | 检测到 Agent 但未安装 Hook |
| — | 未在此系统检测到 Agent |

## 安装 Hook

```bash
guardclaw hooks install [agent]
```

| 参数 | 说明 |
|------|------|
| `claude-code` | 仅为 Claude Code 安装 Hook |
| `codex` | 仅为 Codex 安装 Hook |
| `all` | 为所有检测到的 Agent 安装 Hook |
| *（无）* | 同 `all` |

### Claude Code Hook

将 HTTP Hook 端点安装到 `~/.claude/settings.json`：

- **Pre-tool hook** — `POST /api/cc/pre-tool` — 执行前评估
- **Post-tool hook** — `POST /api/cc/post-tool` — 执行后记录结果
- **Prompt hook** — `POST /api/cc/prompt` — 向提示词注入安全上下文
- **Stop hook** — `POST /api/cc/stop` — 会话结束清理

```bash
guardclaw hooks install claude-code
# ✅ Claude Code hooks installed  (~/.claude/settings.json)
```

### Codex Hook

在 `~/.codex/hooks/` 安装 Hook 配置。

```bash
guardclaw hooks install codex
# ✅ Codex hooks installed
```

### 全部安装

```bash
guardclaw hooks install all
```

仅为系统上检测到的 Agent 安装 Hook。

## 卸载 Hook

```bash
guardclaw hooks uninstall [agent]
```

| 参数 | 说明 |
|------|------|
| `claude-code` | 移除 Claude Code Hook |
| `codex` | 移除 Codex Hook |
| `all` | 移除所有 Hook |
| *（无）* | 同 `all` |

## 支持的 Agent

### 基于 Hook 的 Agent

这些 Agent 支持 GuardClaw Hook，实现**执行前阻断** — GuardClaw 可以在工具调用运行前评估并阻止。

| Agent | 配置路径 | 检测 |
|-------|----------|------|
| Claude Code | `~/.claude/settings.json` | `~/.claude` 目录 |
| Codex | `~/.codex/hooks/` | `~/.codex` 目录 |
| Gemini CLI | `~/.gemini/` | `~/.gemini` 目录 |
| Cursor | `~/.cursor/` | `~/.cursor` 目录 |
| Copilot CLI | `~/.claude/settings.json`（共享） | `~/.copilot` 目录 |

::: info
Copilot CLI 与 Claude Code 共享相同的 Hook 配置格式。
:::

### 基于 WebSocket 的 Agent

这些 Agent 通过 WebSocket 网关连接，实现**监控** — GuardClaw 实时接收工具调用事件。

| Agent | 网关端口 | 配置路径 |
|-------|----------|----------|
| OpenClaw | `18789` | `~/.openclaw/openclaw.json` |
| Qclaw | `28789` | `~/.qclaw/openclaw.json` |

WebSocket Agent 通过保存网关 Token 进行连接：

```bash
# 自动检测并保存
guardclaw config detect-token --save

# 或手动设置
guardclaw config set-token <token>
```

## Hook 工作原理

当基于 Hook 的 Agent（如 Claude Code）即将执行工具调用时：

1. Agent 将工具调用详情发送到 GuardClaw HTTP 端点
2. GuardClaw 通过风险评分流水线运行
3. 基于风险评分和当前阈值：
   - **安全**（1-3 分）→ 自动批准，Agent 继续
   - **警告**（4-7 分）→ 批准但在 Agent 上下文中注入警告
   - **高风险**（8-10 分）→ 阻止，告知 Agent 采用替代方案
4. 执行后，Post-tool Hook 记录结果用于链式分析
