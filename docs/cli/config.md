# Configuration

The `guardclaw config` command manages all GuardClaw settings. Run it without arguments for an interactive menu, or use subcommands for direct access.

```bash
guardclaw config [subcommand]
```

## Subcommands

| Subcommand | Description |
|------------|-------------|
| *(none)* / `menu` | Interactive configuration menu |
| `setup` | Re-run the setup wizard |
| `eval` | Change evaluation mode |
| `llm` | Change LLM backend |
| `mode` | Change approval mode |
| `thresholds` | Change risk thresholds |
| `agents` | Manage agent connections |
| `set <KEY> <VALUE>` | Set any environment variable |
| `show` | Show all current settings |
| `set-token <token>` | Set OpenClaw gateway token |
| `get-token` | Show OpenClaw gateway token |
| `detect-token` | Auto-detect OpenClaw token |

All changes are **hot-reloaded** to the running server — no restart required.

## Interactive menu {#interactive-menu}

```bash
guardclaw config
```

Opens a menu with all configuration categories. Use arrow keys to navigate, Enter to select.

## Setup wizard {#setup-wizard}

```bash
guardclaw setup
# or
guardclaw config setup
```

Re-runs the 4-step first-run wizard:

1. **Evaluation mode** — how risk scoring is performed
2. **LLM backend** — which LLM to use for scoring
3. **Response mode** — how to respond to risky tool calls
4. **Agent connections** — detect and connect AI agents

## Evaluation mode {#eval}

```bash
guardclaw config eval
```

Choose how risk evaluation is performed:

| Mode | Description |
|------|-------------|
| `local-only` | All evaluation done by local LLM — private, fast |
| `mixed` | Local LLM first, cloud escalates risky calls (recommended) |
| `cloud-only` | All evaluation via cloud API |

In **mixed** mode, tool calls that score above a configurable threshold are re-evaluated by a cloud LLM for a second opinion. This combines the speed of local evaluation with the accuracy of larger cloud models.

## LLM backend {#llm}

```bash
guardclaw config llm
```

Interactive picker for the LLM backend used for local risk scoring. Shows the current backend and lets you switch.

### Available backends

| Backend | Value | Description |
|---------|-------|-------------|
| LM Studio | `lmstudio` | Local LLM via LM Studio (default, recommended) |
| MiniMax | `minimax` | MiniMax API |
| Ollama | `ollama` | Local LLM via Ollama |
| Anthropic | `anthropic` | Claude API |
| OpenRouter | `openrouter` | 400+ models via OpenRouter |
| Built-in | `built-in` | Apple Silicon MLX models (downloaded & managed by GuardClaw) |
| Fallback | `fallback` | Rule-based only, no LLM calls |

### LM Studio configuration

When selecting `lmstudio`, you'll be prompted for:

- **URL** — LM Studio API endpoint (default: `http://localhost:1234/v1`)
- **API Key** — optional, if your LM Studio requires authentication
- **Model** — choose from detected models or enter manually (default: `auto`)

The CLI auto-fetches available models from your running LM Studio instance.

::: tip Recommended model
`qwen/qwen3-4b-2507` — fast, accurate, and small enough to run alongside your AI agent.
:::

### Ollama configuration

When selecting `ollama`:

- **URL** — Ollama API endpoint (default: `http://localhost:11434`)
- **Model** — choose from installed models or enter manually (default: `llama3`)

### Anthropic configuration

When selecting `anthropic`:

- **API Key** — your Anthropic API key

### OpenRouter configuration

When selecting `openrouter`:

- **API Key** — your OpenRouter API key
- **Model** — choose from a curated list of popular models

Available OpenRouter models include:

- `openai/gpt-4o`, `openai/gpt-4o-mini`
- `anthropic/claude-sonnet-4-6`, `anthropic/claude-haiku-4-5`
- `google/gemini-2.0-flash-001`
- `meta-llama/llama-3.3-70b-instruct`
- `deepseek/deepseek-r1`
- `qwen/qwen3-235b-a22b`

### MiniMax configuration

When selecting `minimax`:

- **API Key** — your MiniMax API key (or OAuth login)
- **Model** — choose from available MiniMax models

Available models: `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`, `MiniMax-M2.5`, `MiniMax-M2.5-highspeed`, `MiniMax-M2.1`, `MiniMax-M1`, `MiniMax-Text-01`.

### Built-in (MLX)

The built-in backend runs Apple Silicon MLX models directly. Models are downloaded and managed via the dashboard or CLI after the server starts.

```bash
guardclaw model list           # List available models
guardclaw model load <id>      # Load a model
guardclaw model unload         # Unload the current model
```

See [Built-in Backend](/backends/builtin) for details.

### Fallback

Rule-based scoring only — no LLM calls. Uses pattern matching and heuristics. Suitable when no LLM is available or for testing.

### Direct backend switching

```bash
guardclaw config set SAFEGUARD_BACKEND ollama
```

## Approval mode {#mode}

```bash
guardclaw config mode
```

Choose how GuardClaw responds to risky tool calls:

| Mode | Description |
|------|-------------|
| `auto` | Score, warn, and flag risky calls to the agent (recommended) |
| `prompt` | Pause and ask the user for approval on risky calls |
| `monitor-only` | Score and log only, no intervention |

### Direct mode switching

```bash
guardclaw config set GUARDCLAW_APPROVAL_MODE auto
```

## Thresholds {#thresholds}

```bash
guardclaw config thresholds
```

Configure the three risk score thresholds that control GuardClaw's behavior:

| Threshold | Default | Description |
|-----------|---------|-------------|
| Auto-allow | `6` | Scores **at or below** this are auto-allowed |
| Ask | `8` | Scores **at or below** this (in prompt mode) trigger user confirmation |
| Auto-block | `9` | Scores **at or above** this are auto-blocked |

Risk scores range from 1 to 10:

- **1–3**: SAFE (green) — routine operations
- **4–7**: WARNING (yellow) — review recommended
- **8–10**: HIGH RISK (red) — dangerous operations

### Direct threshold changes

```bash
guardclaw config set GUARDCLAW_AUTO_ALLOW_THRESHOLD 5
guardclaw config set GUARDCLAW_ASK_THRESHOLD 7
guardclaw config set GUARDCLAW_AUTO_BLOCK_THRESHOLD 9
```

## Agent connections {#agents}

```bash
guardclaw config agents
```

Interactive agent connection manager. Auto-detects AI agents installed on your system and lets you connect them.

### Detected agents

| Agent | Type | Detection |
|-------|------|-----------|
| Claude Code | Hook | `~/.claude` directory exists |
| Codex | Hook | `~/.codex` directory exists |
| Gemini CLI | Hook | `~/.gemini` directory exists |
| Cursor | Hook | `~/.cursor` directory exists |
| Copilot CLI | Hook | `~/.copilot` directory exists |
| OpenCode | Hook | Binary in PATH |
| OpenClaw | WebSocket | `~/.openclaw/openclaw.json` with token |
| Qclaw | WebSocket | `~/.qclaw/openclaw.json` with token |

**Hook-based agents** are connected by installing hook scripts into the agent's settings. See [Hooks](./hooks).

**WebSocket agents** are connected by saving their gateway token. See [Tokens](#tokens).

## Set any variable {#set}

```bash
guardclaw config set <KEY> <VALUE>
```

Set any environment variable in the `.env` file. The change is hot-reloaded to the running server when applicable.

### Hot-reloaded keys

The following key groups trigger automatic hot-reload:

| Key group | Hot-reload endpoint |
|-----------|-------------------|
| `SAFEGUARD_BACKEND`, `LMSTUDIO_URL`, `LMSTUDIO_MODEL`, `LMSTUDIO_API_KEY`, `LLM_API_KEY`, `OLLAMA_URL`, `OLLAMA_MODEL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | LLM config |
| `OPENCLAW_TOKEN` | OpenClaw connection |
| `QCLAW_TOKEN` | Qclaw connection |
| `GUARDCLAW_APPROVAL_MODE` | Approval mode |
| `GUARDCLAW_AUTO_ALLOW_THRESHOLD`, `GUARDCLAW_ASK_THRESHOLD`, `GUARDCLAW_AUTO_BLOCK_THRESHOLD` | Thresholds |

Keys not in the above groups are saved to `.env` but require a restart to take effect.

### Examples

```bash
# Switch LLM backend
guardclaw config set SAFEGUARD_BACKEND openrouter

# Set OpenRouter API key
guardclaw config set OPENROUTER_API_KEY sk-or-...

# Change approval mode
guardclaw config set GUARDCLAW_APPROVAL_MODE prompt

# Set server port
guardclaw config set PORT 4000

# Set Telegram notifications
guardclaw config set TELEGRAM_BOT_TOKEN 123456:ABC...
guardclaw config set TELEGRAM_CHAT_ID -100123456789
```

## Show settings {#show}

```bash
guardclaw config show
```

Display all current configuration values organized into sections:

### LLM Backend

| Variable | Description |
|----------|-------------|
| `SAFEGUARD_BACKEND` | Active backend |
| `LMSTUDIO_URL` | LM Studio API URL |
| `LMSTUDIO_MODEL` | LM Studio model name |
| `LMSTUDIO_API_KEY` | LM Studio API key |
| `OLLAMA_URL` | Ollama API URL |
| `OLLAMA_MODEL` | Ollama model name |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OPENROUTER_MODEL` | OpenRouter model |
| `OPENAI_API_KEY` | OpenAI API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `KIMI_API_KEY` | Kimi (Moonshot) API key |
| `MINIMAX_API_KEY` | MiniMax API key |

### Cloud Judge

| Variable | Description |
|----------|-------------|
| `CLOUD_JUDGE_ENABLED` | Cloud judge on/off |
| `CLOUD_JUDGE_MODE` | Mode: `local-only`, `mixed`, `cloud-only` |
| `CLOUD_JUDGE_PROVIDER` | Provider: `claude`, `openai-codex`, `minimax`, `kimi`, `openrouter`, `gemini`, `openai` |

### Approval Policy

| Variable | Description |
|----------|-------------|
| `GUARDCLAW_APPROVAL_MODE` | Mode: `auto`, `prompt`, `monitor-only` |
| `GUARDCLAW_AUTO_ALLOW_THRESHOLD` | Auto-allow threshold (scores &le; this) |
| `GUARDCLAW_ASK_THRESHOLD` | Ask threshold (scores &le; this in prompt mode) |
| `GUARDCLAW_AUTO_BLOCK_THRESHOLD` | Auto-block threshold (scores &ge; this) |

### Connections

| Variable | Description |
|----------|-------------|
| `BACKEND` | Gateway mode: `auto`, `openclaw`, `qclaw`, `nanobot` |
| `OPENCLAW_TOKEN` | OpenClaw gateway token |
| `QCLAW_TOKEN` | Qclaw gateway token |
| `PORT` | Server port (default: `3002`) |

### Notifications

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Telegram chat ID |
| `DISCORD_WEBHOOK_URL` | Discord webhook URL |

### Agent Hooks

Also shows the connection status of all detected agents (connected/not connected).

## Tokens {#tokens}

### Set token

```bash
guardclaw config set-token <token>
```

Set the OpenClaw gateway token. Equivalent to `guardclaw config set OPENCLAW_TOKEN <token>`, but with a dedicated command for convenience. Hot-reloaded to the running server.

### Get token

```bash
guardclaw config get-token
```

Display the current OpenClaw token (masked for security):

```
🔑 OPENCLAW_TOKEN: eyJ0eXAi...aGVk
   Full: eyJ0eXAiOi...
```

If no token is set:

```
ℹ️  No OPENCLAW_TOKEN set.
   Set: guardclaw config set-token <token>
   Auto-detect: guardclaw config detect-token
```

### Detect token

```bash
guardclaw config detect-token [--save]
```

Auto-detect the OpenClaw token from `~/.openclaw/openclaw.json`.

| Flag | Description |
|------|-------------|
| `--save`, `-s` | Save the detected token to `.env` and hot-reload |

Without `--save`, it only prints the found token and shows how to save it:

```
✅ Found: eyJ0eXAiOiJKV1Qi...
   To save: guardclaw config set-token eyJ...
   Or:      guardclaw config detect-token --save
```
