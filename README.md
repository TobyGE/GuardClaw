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
  <a href="#quick-start">Quick Start</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#product-tour">Product Tour</a> ·
  <a href="docs/ROADMAP.md">Roadmap</a>
</p>

---

![GuardClaw Dashboard](docs/screenshots/dashboard-overview-2026-03.png)

## The Problem

AI agents usually fail in one of two ways:

- **Too loose:** dangerous operations run with little control
- **Too strict:** safe operations keep interrupting the user

GuardClaw sits between the agent and tools, scores each action with a local or cloud judge, and makes a practical decision:

- safe actions continue without friction
- suspicious actions are surfaced for approval

## Quick Start

### Prerequisites

- Node.js 22.x (LTS)
- `nvm` recommended (or install Node 22.21.1 manually)
- One or more supported agents (see [Supported Agents](#supported-agents) below)

### 1) Install and start

```bash
git clone https://github.com/TobyGE/GuardClaw.git
cd GuardClaw
nvm use || nvm install
npm ci
npm ci --prefix client
npm run verify:native
npm run build
npm link
guardclaw start
```

### 2) Run onboarding in the dashboard (`localhost:3002`)

The onboarding flow walks through setup in order:

1. **Judge** — choose a backend and activate a model
2. **Connections** — install hooks/plugin for your agent
3. **Security Check** — scan for MCP servers, secrets, hooks, and plugin code
4. **Protection** — choose `Strict` (recommended), `Balanced`, or `Monitor`

Restart the target agent after installing hooks/plugin.

### Judge backends

GuardClaw supports three judge modes: **local-only**, **cloud-only**, and **mixed** (default — local judge first, cloud as fallback or for high-risk confirmation).

| Backend | Mode | Description |
| ------- | ---- | ----------- |
| **Built-in (MLX)** | local | Bundled engine using Apple Silicon MLX. Downloads and runs the model locally — no external server needed. |
| **LM Studio** | local | Connect to [LM Studio](https://lmstudio.ai) running locally. Recommended model: `qwen/qwen3-4b-2507` |
| **Ollama** | local | Connect to [Ollama](https://ollama.ai) running locally |
| **Claude (Anthropic)** | cloud | Uses Claude Haiku via Anthropic API or Claude Code OAuth — no API key required if Claude Code is installed |
| **Fallback** | local | Deterministic rule-based scoring only, no LLM |

## Supported Agents

| Agent | Integration | Pre-tool blocking | Approval flow | Notes |
|-------|------------|:-----------------:|:-------------:|-------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | HTTP hooks | ✅ | ✅ | Full support |
| [Codex CLI](https://github.com/openai/codex) | Command hooks | ✅ | ✅ | Full support |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | HTTP hooks | ✅ | ✅ | Full support |
| [OpenCode](https://opencode.ai) | HTTP hooks | ✅ | ✅ | Full support |
| [OpenClaw](https://github.com/openclaw/openclaw) | WebSocket plugin | ✅ | ✅ | Full support; requires gateway |
| [Cursor](https://cursor.com) | Shell hooks | ⚠️ | ✅ | Shell commands only — file operations (read/write/edit) are not intercepted |
| [GitHub Copilot CLI](https://github.com/github/copilot-sdk) | Extension | ❌ | ❌ | Not functional — waiting on stable extension SDK |

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

### Key capabilities

- **Rule-based fast path** — obvious safe/dangerous cases skip the LLM entirely
- **Chain analysis** — tracks tool call history per session to detect multi-step attacks (e.g. read credentials then exfiltrate)
- **Adaptive memory** — learns from user approve/deny decisions to reduce repeated prompts
- **Context-aware scoring** — considers user intent, working directory, and tool history

## Product Tour

### Dashboard

The web dashboard (`localhost:3002`) is the central control plane: event timeline, risk filters, session visibility, blocking toggles.

![Dashboard](docs/screenshots/dashboard-overview-2026-03.png)

### Security Scan

Static checks for MCP configuration, secrets exposure, and agentic-risk patterns.

![Security Scan](docs/screenshots/security-scan-clean-2026-03.png)

### Menu Bar App (macOS)

[GuardClawBar](docs/GUARDCLAWBAR.md) provides native monitoring and quick actions from the menu bar.

![GuardClawBar](docs/screenshots/menubar-claude-tab-2026-03.png)

## CLI Reference

```
guardclaw start              # start server (opens dashboard)
guardclaw stop               # stop server

guardclaw status             # server & judge status
guardclaw stats              # event counts and risk breakdown
guardclaw history [n]        # recent events (default 10)
guardclaw model              # active judge model info
guardclaw blocking [on|off]  # view or toggle blocking
guardclaw check <command>    # check risk score for a command
guardclaw approvals          # pending approval requests
guardclaw memory             # learned safe/risky patterns

guardclaw plugin install     # install OpenClaw plugin
guardclaw plugin uninstall
guardclaw plugin status

guardclaw help
```

## Links

- [Roadmap](docs/ROADMAP.md)
- [Menu Bar App](docs/GUARDCLAWBAR.md)
- [LM Studio Troubleshooting](docs/LMSTUDIO-TROUBLESHOOTING.md)

---

<p align="center">
  <sub>Built for practical agent safety. Your data stays on your machine.</sub>
</p>
