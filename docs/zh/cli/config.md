# 配置管理

`guardclaw config` 命令管理所有 GuardClaw 设置。不带参数运行将显示交互式菜单，也可以使用子命令直接访问。

```bash
guardclaw config [子命令]
```

## 子命令

| 子命令 | 说明 |
|--------|------|
| *（无）* / `menu` | 交互式配置菜单 |
| `setup` | 重新运行配置向导 |
| `eval` | 更改评估模式 |
| `llm` | 更改 LLM 后端 |
| `mode` | 更改审批模式 |
| `thresholds` | 更改风险阈值 |
| `agents` | 管理 Agent 连接 |
| `set <KEY> <VALUE>` | 设置任意环境变量 |
| `show` | 显示所有当前设置 |
| `set-token <token>` | 设置 OpenClaw 网关 Token |
| `get-token` | 显示 OpenClaw 网关 Token |
| `detect-token` | 自动检测 OpenClaw Token |

所有更改**热重载**到运行中的服务器 — 无需重启。

## 交互式菜单 {#interactive-menu}

```bash
guardclaw config
```

打开包含所有配置类别的菜单。使用方向键导航，Enter 选择。

## 配置向导 {#setup-wizard}

```bash
guardclaw setup
# 或
guardclaw config setup
```

重新运行首次启动的 4 步向导：

1. **评估模式** — 如何执行风险评分
2. **LLM 后端** — 使用哪个 LLM 进行评分
3. **响应模式** — 如何响应高风险工具调用
4. **Agent 连接** — 检测并连接 AI Agent

## 评估模式 {#eval}

```bash
guardclaw config eval
```

选择风险评估的执行方式：

| 模式 | 说明 |
|------|------|
| `local-only` | 所有评估由本地 LLM 完成 — 私密、快速 |
| `mixed` | 本地 LLM 优先，高风险调用升级到云端（推荐） |
| `cloud-only` | 所有评估通过云端 API |

**混合模式**下，评分超过阈值的工具调用会由云端 LLM 重新评估。结合了本地评估的速度和云端大模型的准确性。

## LLM 后端 {#llm}

```bash
guardclaw config llm
```

用于选择本地风险评分 LLM 后端的交互式选择器。

### 可用后端

| 后端 | 值 | 说明 |
|------|-----|------|
| LM Studio | `lmstudio` | 本地 LLM（默认，推荐） |
| MiniMax | `minimax` | MiniMax API |
| Ollama | `ollama` | 本地 LLM |
| Anthropic | `anthropic` | Claude API |
| OpenRouter | `openrouter` | 400+ 模型 |
| 内置 | `built-in` | Apple Silicon MLX 模型 |
| Fallback | `fallback` | 仅规则匹配，无 LLM |

### LM Studio 配置

选择 `lmstudio` 时需要配置：

- **URL** — LM Studio API 端点（默认：`http://localhost:1234/v1`）
- **API Key** — 可选，如果 LM Studio 需要认证
- **模型** — 从检测到的模型中选择或手动输入（默认：`auto`）

::: tip 推荐模型
`qwen/qwen3-4b-2507` — 快速、准确，体积足够小，可与 AI Agent 同时运行。
:::

### Ollama 配置

- **URL** — Ollama API 端点（默认：`http://localhost:11434`）
- **模型** — 从已安装的模型中选择或手动输入（默认：`llama3`）

### Anthropic 配置

- **API Key** — Anthropic API 密钥

### OpenRouter 配置

- **API Key** — OpenRouter API 密钥
- **模型** — 从热门模型列表中选择

### MiniMax 配置

- **API Key** — MiniMax API 密钥（或 OAuth 登录）
- **模型** — 从可用模型中选择

### 内置（MLX）

内置后端直接运行 Apple Silicon MLX 模型。模型通过控制面板或 CLI 在服务器启动后下载和管理。

### Fallback

仅使用规则匹配评分 — 无 LLM 调用。适用于无 LLM 可用或测试场景。

### 直接切换后端

```bash
guardclaw config set SAFEGUARD_BACKEND ollama
```

## 审批模式 {#mode}

```bash
guardclaw config mode
```

选择 GuardClaw 如何响应高风险工具调用：

| 模式 | 说明 |
|------|------|
| `auto` | 评分、警告并标记高风险调用给 Agent（推荐） |
| `prompt` | 暂停执行，请求用户批准 |
| `monitor-only` | 仅评分和记录，不干预 |

### 直接切换模式

```bash
guardclaw config set GUARDCLAW_APPROVAL_MODE auto
```

## 阈值设置 {#thresholds}

```bash
guardclaw config thresholds
```

配置控制 GuardClaw 行为的三个风险评分阈值：

| 阈值 | 默认值 | 说明 |
|------|--------|------|
| 自动允许 | `6` | 评分**小于等于**此值则自动允许 |
| 询问 | `8` | 评分**小于等于**此值（prompt 模式下）触发用户确认 |
| 自动阻断 | `9` | 评分**大于等于**此值则自动阻断 |

风险评分范围 1-10：

- **1-3**：安全（绿色）— 常规操作
- **4-7**：警告（黄色）— 建议审查
- **8-10**：高风险（红色）— 危险操作

### 直接修改阈值

```bash
guardclaw config set GUARDCLAW_AUTO_ALLOW_THRESHOLD 5
guardclaw config set GUARDCLAW_ASK_THRESHOLD 7
guardclaw config set GUARDCLAW_AUTO_BLOCK_THRESHOLD 9
```

## Agent 连接 {#agents}

```bash
guardclaw config agents
```

交互式 Agent 连接管理器。自动检测系统上安装的 AI Agent 并连接。

### 支持的 Agent

| Agent | 类型 | 检测方式 |
|-------|------|----------|
| Claude Code | Hook | `~/.claude` 目录存在 |
| Codex | Hook | `~/.codex` 目录存在 |
| Gemini CLI | Hook | `~/.gemini` 目录存在 |
| Cursor | Hook | `~/.cursor` 目录存在 |
| Copilot CLI | Hook | `~/.copilot` 目录存在 |
| OpenCode | Hook | 二进制文件在 PATH 中 |
| OpenClaw | WebSocket | `~/.openclaw/openclaw.json` 中有 Token |
| Qclaw | WebSocket | `~/.qclaw/openclaw.json` 中有 Token |

## 设置任意变量 {#set}

```bash
guardclaw config set <KEY> <VALUE>
```

设置 `.env` 文件中的任意环境变量。适用时会热重载到运行中的服务器。

### 热重载的键

| 键组 | 热重载端点 |
|------|-----------|
| `SAFEGUARD_BACKEND`、`LMSTUDIO_*`、`OLLAMA_*`、`OPENROUTER_*`、`LLM_API_KEY` | LLM 配置 |
| `OPENCLAW_TOKEN` | OpenClaw 连接 |
| `QCLAW_TOKEN` | Qclaw 连接 |
| `GUARDCLAW_APPROVAL_MODE` | 审批模式 |
| `GUARDCLAW_AUTO_ALLOW_THRESHOLD`、`GUARDCLAW_ASK_THRESHOLD`、`GUARDCLAW_AUTO_BLOCK_THRESHOLD` | 阈值 |

不在上述组中的键保存到 `.env`，但需要重启才能生效。

### 示例

```bash
# 切换 LLM 后端
guardclaw config set SAFEGUARD_BACKEND openrouter

# 设置 OpenRouter API 密钥
guardclaw config set OPENROUTER_API_KEY sk-or-...

# 更改审批模式
guardclaw config set GUARDCLAW_APPROVAL_MODE prompt

# 设置服务器端口
guardclaw config set PORT 4000
```

## 查看设置 {#show}

```bash
guardclaw config show
```

分区域显示所有当前配置值：LLM 后端、云端评估、审批策略、连接、通知、Agent Hook。

## Token 管理 {#tokens}

### 设置 Token

```bash
guardclaw config set-token <token>
```

设置 OpenClaw 网关 Token。等同于 `guardclaw config set OPENCLAW_TOKEN <token>`，但更方便。

### 获取 Token

```bash
guardclaw config get-token
```

显示当前 OpenClaw Token（出于安全考虑会部分隐藏）。

### 检测 Token

```bash
guardclaw config detect-token [--save]
```

从 `~/.openclaw/openclaw.json` 自动检测 OpenClaw Token。

| 参数 | 说明 |
|------|------|
| `--save`, `-s` | 保存检测到的 Token 到 `.env` 并热重载 |

不带 `--save` 时仅打印找到的 Token 和保存方法。
