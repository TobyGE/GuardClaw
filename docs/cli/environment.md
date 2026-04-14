# Environment Variables

GuardClaw is configured through environment variables stored in a `.env` file in your working directory. All variables can be set via `guardclaw config set` or by editing `.env` directly.

## Quick reference

```bash
# View all current settings
guardclaw config show

# Set a variable
guardclaw config set <KEY> <VALUE>
```

## LLM Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `SAFEGUARD_BACKEND` | `lmstudio` | Active LLM backend for risk scoring |
| `LMSTUDIO_URL` | `http://localhost:1234/v1` | LM Studio / OpenAI-compatible API URL |
| `LMSTUDIO_MODEL` | `auto` | Model name (or `auto` to use whatever is loaded) |
| `LMSTUDIO_API_KEY` | — | API key for LM Studio (optional) |
| `LLM_API_KEY` | — | Generic LLM API key |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API URL |
| `OLLAMA_MODEL` | `llama3` | Ollama model name |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (for `anthropic` backend) |
| `OPENROUTER_API_KEY` | — | OpenRouter API key |
| `OPENROUTER_MODEL` | — | OpenRouter model ID (e.g. `openai/gpt-4o`) |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `GEMINI_API_KEY` | — | Google Gemini API key |
| `KIMI_API_KEY` | — | Kimi (Moonshot) API key |
| `MINIMAX_API_KEY` | — | MiniMax API key |

### Backend values

| Value | Description |
|-------|-------------|
| `lmstudio` | Local LLM via LM Studio (recommended) |
| `ollama` | Local LLM via Ollama |
| `anthropic` | Claude API |
| `openrouter` | OpenRouter (400+ models) |
| `minimax` | MiniMax API |
| `built-in` | Apple Silicon MLX models |
| `fallback` | Rule-based only, no LLM |

## Cloud Judge

| Variable | Default | Description |
|----------|---------|-------------|
| `CLOUD_JUDGE_ENABLED` | `false` | Enable cloud-based escalation |
| `CLOUD_JUDGE_MODE` | `local-only` | Evaluation mode |
| `CLOUD_JUDGE_PROVIDER` | — | Cloud provider for escalation |

### Evaluation modes

| Mode | Description |
|------|-------------|
| `local-only` | All evaluation on local LLM |
| `mixed` | Local first, cloud escalates risky calls |
| `cloud-only` | All evaluation via cloud API |

### Cloud providers

| Provider | Description |
|----------|-------------|
| `claude` | Anthropic Claude (OAuth or API key) |
| `openai-codex` | OpenAI Codex / ChatGPT (OAuth or API key) |
| `minimax` | MiniMax (OAuth or API key) |
| `kimi` | Kimi / Moonshot (API key) |
| `openrouter` | OpenRouter (API key) |
| `gemini` | Google Gemini (API key) |
| `openai` | OpenAI (API key) |

## Approval Policy

| Variable | Default | Description |
|----------|---------|-------------|
| `GUARDCLAW_APPROVAL_MODE` | `auto` | How to respond to risky tool calls |
| `GUARDCLAW_AUTO_ALLOW_THRESHOLD` | `6` | Scores at or below this are auto-allowed |
| `GUARDCLAW_ASK_THRESHOLD` | `8` | Scores at or below this (in prompt mode) trigger user confirmation |
| `GUARDCLAW_AUTO_BLOCK_THRESHOLD` | `9` | Scores at or above this are auto-blocked |

### Approval modes

| Mode | Description |
|------|-------------|
| `auto` | Score, warn agent, and flag risky calls (recommended) |
| `prompt` | Pause execution and ask user for approval |
| `monitor-only` | Score and log only, no intervention |

### Threshold behavior

Risk scores range from 1 to 10. The three thresholds control the decision flow:

```
Score: 1 ──── 3 ──── 6 ──── 8 ──── 9 ──── 10
       │  SAFE  │ WARN │ ASK  │ BLOCK │
       └────────┘──────┘──────┘───────┘
          auto-allow    ask     auto-block
```

- **Score &le; auto-allow** (default &le; 6): automatically allowed
- **Score &le; ask** (default &le; 8): in `prompt` mode, asks user; in `auto` mode, warns agent
- **Score &ge; auto-block** (default &ge; 9): automatically blocked

## Connections

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND` | `auto` | Gateway connection mode |
| `OPENCLAW_TOKEN` | — | OpenClaw gateway authentication token |
| `QCLAW_TOKEN` | — | Qclaw gateway authentication token |
| `PORT` | `3002` | GuardClaw server port |

### Gateway modes

| Mode | Description |
|------|-------------|
| `auto` | Connect to any detected gateway |
| `openclaw` | Connect to OpenClaw gateway only |
| `qclaw` | Connect to Qclaw gateway only |
| `nanobot` | Connect to nanobot gateway only |

## Notifications

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token for alert notifications |
| `TELEGRAM_CHAT_ID` | — | Telegram chat ID to send alerts to |
| `DISCORD_WEBHOOK_URL` | — | Discord webhook URL for alert notifications |

## .env file location

The `.env` file is loaded from **your current working directory** when starting GuardClaw. This allows per-project configuration.

```bash
# In project A
cd ~/projects/project-a
guardclaw start
# Reads ~/projects/project-a/.env

# In project B
cd ~/projects/project-b
guardclaw start
# Reads ~/projects/project-b/.env
```

## Example .env

```ini
# LLM Backend
SAFEGUARD_BACKEND=lmstudio
LMSTUDIO_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=auto

# Cloud Judge (mixed mode)
CLOUD_JUDGE_ENABLED=true
CLOUD_JUDGE_MODE=mixed
CLOUD_JUDGE_PROVIDER=claude

# Approval Policy
GUARDCLAW_APPROVAL_MODE=auto
GUARDCLAW_AUTO_ALLOW_THRESHOLD=6
GUARDCLAW_ASK_THRESHOLD=8
GUARDCLAW_AUTO_BLOCK_THRESHOLD=9

# Server
PORT=3002

# Agent Connections
OPENCLAW_TOKEN=eyJ0eXAiOiJKV1Qi...
```
