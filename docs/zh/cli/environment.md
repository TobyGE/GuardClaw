# 环境变量

GuardClaw 通过存储在工作目录 `.env` 文件中的环境变量进行配置。所有变量都可以通过 `guardclaw config set` 设置或直接编辑 `.env`。

## 快速参考

```bash
# 查看所有当前设置
guardclaw config show

# 设置变量
guardclaw config set <KEY> <VALUE>
```

## LLM 后端

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SAFEGUARD_BACKEND` | `lmstudio` | 活动的风险评分 LLM 后端 |
| `LMSTUDIO_URL` | `http://localhost:1234/v1` | LM Studio / OpenAI 兼容 API URL |
| `LMSTUDIO_MODEL` | `auto` | 模型名称（`auto` 使用已加载的模型） |
| `LMSTUDIO_API_KEY` | — | LM Studio API 密钥（可选） |
| `LLM_API_KEY` | — | 通用 LLM API 密钥 |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API URL |
| `OLLAMA_MODEL` | `llama3` | Ollama 模型名称 |
| `ANTHROPIC_API_KEY` | — | Anthropic API 密钥 |
| `OPENROUTER_API_KEY` | — | OpenRouter API 密钥 |
| `OPENROUTER_MODEL` | — | OpenRouter 模型 ID |
| `OPENAI_API_KEY` | — | OpenAI API 密钥 |
| `GEMINI_API_KEY` | — | Google Gemini API 密钥 |
| `KIMI_API_KEY` | — | Kimi（Moonshot）API 密钥 |
| `MINIMAX_API_KEY` | — | MiniMax API 密钥 |

### 后端取值

| 值 | 说明 |
|----|------|
| `lmstudio` | 本地 LLM via LM Studio（推荐） |
| `ollama` | 本地 LLM via Ollama |
| `anthropic` | Claude API |
| `openrouter` | OpenRouter（400+ 模型） |
| `minimax` | MiniMax API |
| `built-in` | Apple Silicon MLX 模型 |
| `fallback` | 仅规则匹配，无 LLM |

## 云端评估

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CLOUD_JUDGE_ENABLED` | `false` | 启用云端升级评估 |
| `CLOUD_JUDGE_MODE` | `local-only` | 评估模式 |
| `CLOUD_JUDGE_PROVIDER` | — | 云端升级提供商 |

### 评估模式

| 模式 | 说明 |
|------|------|
| `local-only` | 所有评估在本地 LLM |
| `mixed` | 本地优先，高风险调用升级到云端 |
| `cloud-only` | 所有评估通过云端 API |

### 云端提供商

| 提供商 | 说明 |
|--------|------|
| `claude` | Anthropic Claude（OAuth 或 API 密钥） |
| `openai-codex` | OpenAI Codex / ChatGPT（OAuth 或 API 密钥） |
| `minimax` | MiniMax（OAuth 或 API 密钥） |
| `kimi` | Kimi / Moonshot（API 密钥） |
| `openrouter` | OpenRouter（API 密钥） |
| `gemini` | Google Gemini（API 密钥） |
| `openai` | OpenAI（API 密钥） |

## 审批策略

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GUARDCLAW_APPROVAL_MODE` | `auto` | 如何响应高风险工具调用 |
| `GUARDCLAW_AUTO_ALLOW_THRESHOLD` | `6` | 评分 ≤ 此值则自动允许 |
| `GUARDCLAW_ASK_THRESHOLD` | `8` | 评分 ≤ 此值（prompt 模式）触发用户确认 |
| `GUARDCLAW_AUTO_BLOCK_THRESHOLD` | `9` | 评分 ≥ 此值则自动阻断 |

### 审批模式

| 模式 | 说明 |
|------|------|
| `auto` | 评分、警告 Agent 并标记高风险调用（推荐） |
| `prompt` | 暂停执行，请求用户批准 |
| `monitor-only` | 仅评分和记录，不干预 |

### 阈值行为

风险评分范围 1-10。三个阈值控制决策流程：

```
评分: 1 ──── 3 ──── 6 ──── 8 ──── 9 ──── 10
      │ 安全 │ 警告 │ 询问 │ 阻断 │
      └──────┘──────┘──────┘──────┘
         自动允许   询问  自动阻断
```

- **评分 ≤ 自动允许**（默认 ≤ 6）：自动允许
- **评分 ≤ 询问**（默认 ≤ 8）：`prompt` 模式下询问用户；`auto` 模式下警告 Agent
- **评分 ≥ 自动阻断**（默认 ≥ 9）：自动阻断

## 连接

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BACKEND` | `auto` | 网关连接模式 |
| `OPENCLAW_TOKEN` | — | OpenClaw 网关认证 Token |
| `QCLAW_TOKEN` | — | Qclaw 网关认证 Token |
| `PORT` | `3002` | GuardClaw 服务器端口 |

### 网关模式

| 模式 | 说明 |
|------|------|
| `auto` | 连接到检测到的任意网关 |
| `openclaw` | 仅连接 OpenClaw 网关 |
| `qclaw` | 仅连接 Qclaw 网关 |
| `nanobot` | 仅连接 nanobot 网关 |

## 通知

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TELEGRAM_BOT_TOKEN` | — | Telegram 告警机器人 Token |
| `TELEGRAM_CHAT_ID` | — | 接收告警的 Telegram 聊天 ID |
| `DISCORD_WEBHOOK_URL` | — | Discord 告警 Webhook URL |

## .env 文件位置

`.env` 文件在启动 GuardClaw 时从**当前工作目录**加载。这允许每个项目独立配置。

```bash
# 在项目 A 中
cd ~/projects/project-a
guardclaw start
# 读取 ~/projects/project-a/.env

# 在项目 B 中
cd ~/projects/project-b
guardclaw start
# 读取 ~/projects/project-b/.env
```

## .env 示例

```ini
# LLM 后端
SAFEGUARD_BACKEND=lmstudio
LMSTUDIO_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=auto

# 云端评估（混合模式）
CLOUD_JUDGE_ENABLED=true
CLOUD_JUDGE_MODE=mixed
CLOUD_JUDGE_PROVIDER=claude

# 审批策略
GUARDCLAW_APPROVAL_MODE=auto
GUARDCLAW_AUTO_ALLOW_THRESHOLD=6
GUARDCLAW_ASK_THRESHOLD=8
GUARDCLAW_AUTO_BLOCK_THRESHOLD=9

# 服务器
PORT=3002

# Agent 连接
OPENCLAW_TOKEN=eyJ0eXAiOiJKV1Qi...
```
