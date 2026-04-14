# Quick Start

Requires **Node.js >= 18**. No account needed.

## Install

```bash
npm install -g guardclaw
guardclaw start
```

Takes about 30 seconds. First launch opens an interactive setup wizard.

## Setup Wizard

The wizard walks you through four choices:

1. **Evaluation mode** — local, mixed, or cloud
2. **LLM backend** — pick a local model (LM Studio, Ollama, built-in MLX) or a cloud provider (Claude, OpenAI Codex, MiniMax, Kimi, OpenRouter, Gemini)
3. **Response mode** — `Auto` (flag and block risky calls) or `Monitor only` (log without blocking)
4. **Agent connections** — auto-detects installed agents and installs hooks/plugins with one confirm

Re-run any time with:

```bash
guardclaw setup
```

Restart your AI agent after installing hooks.

## Dashboard

Once running, open the dashboard at [localhost:3002](http://localhost:3002).

The dashboard shows:
- Live event timeline with risk scores
- Per-session tool call history
- Blocking toggle (on/off without restart)
- Settings panel for LLM backend configuration

## Risk Tiers

| Score | Verdict | Behavior |
|-------|---------|----------|
| 1–3   | SAFE    | Runs normally |
| 4–7   | WARNING | Logged with elevated audit signal |
| 8–10  | HIGH RISK | Blocked / requires approval |

## Uninstall

```bash
guardclaw stop
npm uninstall -g guardclaw
node scripts/install-claude-code.js --uninstall  # remove hooks
```
