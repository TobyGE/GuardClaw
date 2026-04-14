# Configuration

All configuration is stored in `~/.guardclaw/.env`. You can edit it via the CLI or the dashboard Settings panel — no manual file editing needed.

## CLI Configuration

```bash
guardclaw config llm          # interactive LLM backend picker
guardclaw config mode         # set approval mode (auto / prompt / monitor-only)
guardclaw config thresholds   # set risk score thresholds
guardclaw config show         # print current config
guardclaw config set KEY VALUE  # set any env var, applied immediately
```

All `config` commands apply changes to the running server instantly — no restart needed.

## Approval Modes

| Mode | Behavior |
|------|----------|
| `auto` | Auto-allow score ≤ 6, auto-block score ≥ 9, warn on 7–8 |
| `prompt` | Ask user for approval on score 7–8 |
| `monitor-only` | Never block, just log everything |

Set via CLI:
```bash
guardclaw config mode
# or directly:
guardclaw config set GUARDCLAW_APPROVAL_MODE prompt
```

## Risk Thresholds

| Variable | Default | Meaning |
|----------|---------|---------|
| `GUARDCLAW_AUTO_ALLOW_THRESHOLD` | `6` | Score ≤ this → auto-allow |
| `GUARDCLAW_ASK_THRESHOLD` | `8` | Score ≤ this → ask user (prompt mode) |
| `GUARDCLAW_AUTO_BLOCK_THRESHOLD` | `9` | Score ≥ this → auto-block |

```bash
guardclaw config thresholds
```

## Environment Variables

Full list of supported variables:

```bash
# LLM Backend
SAFEGUARD_BACKEND=lmstudio    # lmstudio | ollama | anthropic | built-in | openrouter | fallback

# LM Studio
LMSTUDIO_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=auto
LMSTUDIO_API_KEY=             # optional, for hosted OpenAI-compatible endpoints

# Ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# OpenRouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=openai/gpt-4o

# Approval
GUARDCLAW_APPROVAL_MODE=auto
GUARDCLAW_AUTO_ALLOW_THRESHOLD=6
GUARDCLAW_ASK_THRESHOLD=8
GUARDCLAW_AUTO_BLOCK_THRESHOLD=9

# Server
PORT=3002
```

## Dashboard Settings Panel

Open the ⚙️ Settings panel in the dashboard to:
- Switch LLM backend and model
- Test connection to the backend
- Toggle fail-closed mode
- Manage whitelist/blacklist

Changes apply instantly without restart.
