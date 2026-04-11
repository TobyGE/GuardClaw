<p align="center">
  <h1 align="center">
    <img src="docs/favicon.svg" width="36" height="36" alt="GuardClaw logo" style="vertical-align: middle;">
    GuardClaw
  </h1>
  <p align="center">
    <strong>Smart permission layer for AI agents</strong>
  </p>
  <p align="center">
    Real-time risk judgment for agent tool calls. Runs local or cloud.
  </p>
</p>

<p align="center">
  <a href="#the-problem">The Problem</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#product-tour">Product Tour</a> ·
  <a href="docs/ROADMAP.md">Roadmap</a>
</p>

---

## The Problem

AI agents usually fail in one of two ways:

- **Too loose:** dangerous operations run with little control
- **Too strict:** safe operations keep interrupting the user

GuardClaw sits between the agent and tools, scores each action with a local or cloud judge, and makes a practical decision:

- safe actions continue without friction
- suspicious actions are surfaced for approval

## How It Works

1. Agent calls a tool (exec, read, write, browser, etc.)
2. GuardClaw captures context and sends it to the local judge model
3. The model returns risk score + verdict + reasoning
4. GuardClaw logs, allows, or gates execution based on policy

### Risk Tiers

| Score | Verdict | Behavior |
| ----- | ------- | -------- |
| 1-3 | SAFE | Runs normally |
| 4-7 | WARNING | Runs with stronger audit signal |
| 8-10 | HIGH RISK | Requires approval / blocking |

### Architecture

GuardClaw is built from four core subsystems that work together:

#### 1. Two-Stage Judge

Every tool call goes through a two-stage evaluation pipeline:

| Stage | Engine | Latency | When |
|-------|--------|---------|------|
| **Local Judge** | Qwen3-4B via LM Studio / Ollama / MLX | <100ms | Every tool call |
| **Cloud Judge** | Claude (Anthropic) | ~1s | High-risk only (score >= 8) |

Before hitting the LLM, three fast paths run first:
- **High-risk patterns** — regex match (e.g. `curl | bash`, `nc -e`) → instant score 9
- **Safe fast-path** — known safe commands (git status, npm test) → instant score 1
- **Agent permissions (Layer 1)** — reads each agent's own config, auto-allows if the agent already permits it

The cloud judge receives richer context: the session security brief, project-level security context, and global knowledge — enabling it to detect attacks that span many tool calls.

#### 2. Multi-Level Security Memory

A four-level memory hierarchy designed to detect long-range attacks that unfold over hundreds of tool calls:

| Level | What | Storage | Lifecycle |
|-------|------|---------|-----------|
| **L0 — Raw Buffer** | Every tool call with data flow tags (`reads:.env`, `fetches:evil.com`, `sends-file:/tmp/x`) | In-memory | Per session |
| **L1 — AI Brief** | Rolling AI summary of the session. Triggered when L0 hits 60K tokens. `new_brief = AI(old_brief + new_events)` — early signals survive multiple compressions | In-memory | Per session |
| **L2 — Project Context** | AI-generated security baseline for this project (safe patterns, trusted domains, known risks). Updated at session end | `~/.guardclaw/security-context.md` | Persistent, cross-session |
| **L3 — Global Knowledge** | Cross-project intelligence (malicious domains, attack patterns, dangerous MCP servers). Updated only when L1 brief contains high-severity findings | `~/.guardclaw/global-knowledge.md` | Persistent, cross-project |

Data flows upward: L0 → compress → L1 → session end → L2 → high-severity → L3. The cloud judge sees L1 + L2 + L3 in its prompt, so it can catch attacks that no single tool call reveals.

#### 3. Adaptive Memory & Chain Analysis

- **Adaptive memory** (`memory.db`) — SQLite-backed pattern learning from user approve/deny decisions. Repeated approvals → auto-approve, reducing friction over time
- **Chain analysis** — tracks tool call sequences per session to detect multi-step exfiltration (read `~/.ssh/id_rsa` → `curl evil.com`)
- **Intent classification** — LLM classifies user prompt intent; deviations raise risk floors (agent doing something the user didn't ask for)
- **Session signals** — cumulative session state: credential reads, network usage, sensitive file access, risk budget with decay

#### 4. Active Intervention & Approval

When risk is detected, GuardClaw doesn't just score — it acts:

- **Proactive intervention** — injects safety guidance into the agent's context via `systemMessage` before the tool runs (e.g. "credentials were read earlier — network operations will be scrutinized")
- **Dual-channel approval** — high-risk operations trigger both the agent's native dialog AND the GuardClaw dashboard/menu bar, plus optional push notifications (Telegram, Discord, WhatsApp)
- **Circuit breaker** — too many consecutive denials → degrades to ask mode, preventing agent deadlocks
- **Credential scanning** — PostToolUse output scanned for leaked secrets (API keys, tokens, private keys)
- **Prompt injection detection** — UserPromptSubmit hook catches common injection patterns
- **Skill security review** — LLM reviews `/skill` file contents for instruction injection
- **DTrace syscall monitoring** — OS-level monitoring of MCP server system calls (file, network, process) on macOS

## Quick Start

Requires Node.js >= 18.

```bash
npm install -g guardclaw
guardclaw start
```

First launch opens an interactive wizard:

1. **Evaluation mode** — local / mixed / cloud
2. **LLM backend** — local (LM Studio, Ollama, built-in MLX) and/or cloud (Claude, OpenAI Codex, MiniMax, Kimi, OpenRouter, Gemini, OpenAI). Cloud providers support OAuth or API key.
3. **Response mode** — `Auto` (warn and flag risky calls) or `Monitor only` (log without intervention)
4. **Agent connections** — auto-detects installed agents and installs hooks/plugins with one confirm

Re-run any time with `guardclaw setup`. Restart the target agent after installing hooks.

## Supported Agents

| Agent | Integration | Pre-tool blocking | Approval flow | Notes |
|-------|------------|:-----------------:|:-------------:|-------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | HTTP hooks | ✅ | ✅ | Full support |
| [Codex CLI](https://github.com/openai/codex) | Command hooks | ✅ | ✅ | Full support |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | HTTP hooks | ✅ | ✅ | Full support |
| [OpenCode](https://opencode.ai) | HTTP hooks | ✅ | ✅ | Full support |
| [OpenClaw](https://github.com/openclaw/openclaw) | WebSocket plugin | ✅ | ✅ | Full support; requires gateway |
| [Cursor](https://cursor.com) | Shell hooks | ⚠️ | ✅ | Shell commands only — file operations (read/write/edit) are not intercepted |
| [GitHub Copilot CLI](https://github.com/github/copilot-sdk) | HTTP hooks (shared with CC) | ✅ | ✅ | Full support via Claude Code hook endpoint |

## Product Tour

### Dashboard

The web dashboard (`localhost:3002`) is the central control plane: event timeline, risk filters, session visibility, blocking toggles.

![Dashboard](docs/screenshots/dashboard-overview-2026-03.png)

### Security Scan

Static checks for MCP configuration, secrets exposure, and agentic-risk patterns.

![Security Scan](docs/screenshots/security-scan-clean-2026-03.png)

### Menu Bar App (macOS)

<img align="right" src="docs/screenshots/menubar-claude-tab-2026-03.png" width="320" alt="GuardClawBar">

[GuardClawBar](docs/GUARDCLAWBAR.md) lives in the macOS menu bar so you can monitor GuardClaw without keeping the dashboard tab open. The popover shows live per-agent event counts, recent risky calls, and a quick toggle for blocking mode — each agent (Claude Code, Codex, Gemini, OpenClaw) has its own tab. Approval prompts fire as native notifications so you can allow or deny right from the corner of your screen.

<br clear="right">


## CLI Reference

```
guardclaw start          # start server (opens dashboard)
guardclaw stop           # stop server
guardclaw setup          # re-run the interactive setup wizard
guardclaw status         # server & judge status
guardclaw check <cmd>    # manually risk-score a command
guardclaw help           # full command list
```

## Development

To hack on GuardClaw itself, install from source:

```bash
git clone https://github.com/TobyGE/GuardClaw.git
cd GuardClaw
nvm use || nvm install
npm ci && npm ci --prefix client
npm run build
npm link
guardclaw start
```

`npm run dev` runs server (nodemon) + client (Vite) concurrently. See [CLAUDE.md](CLAUDE.md) for the architecture overview.

## Links

- [Roadmap](docs/ROADMAP.md)
- [Menu Bar App](docs/GUARDCLAWBAR.md)
- [LM Studio Troubleshooting](docs/LMSTUDIO-TROUBLESHOOTING.md)

---

<p align="center">
  <sub>Built for practical agent safety. Your data stays on your machine.</sub>
</p>
