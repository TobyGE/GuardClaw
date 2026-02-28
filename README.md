<p align="center">
  <h1 align="center"><img src="docs/favicon.svg" width="36" height="36" alt="GuardClaw logo" style="vertical-align: middle;"> GuardClaw</h1>
  <p align="center">
    <strong>Real-time security monitor for AI agents — powered by local LLMs</strong>
  </p>
  <p align="center">
    Every tool call risk-scored before execution · 100% local · zero cloud
  </p>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#claude-code-integration">Claude Code</a> ·
  <a href="#dashboard-guide">Dashboard Guide</a> ·
  <a href="#active-blocking-details">Active Blocking</a> ·
  <a href="docs/ROADMAP.md">Roadmap</a>
</p>

---

![GuardClaw Dashboard](docs/screenshots/dashboard.png?v=3)

## Why GuardClaw?

AI coding agents (`exec`, `write`, `curl`, etc.) can do real damage. GuardClaw watches every tool call your agent makes and scores it for risk — **before it runs**. Everything stays on your machine: analysis runs on a local LLM (LM Studio or Ollama), no data ever leaves.

**What you get:**
- **Real-time visibility** — see every tool call as it happens, with AI-generated summaries
- **3-tier risk scoring** — SAFE / WARNING / BLOCK, 100% accuracy on our 30-case benchmark
- **Optional blocking** — high-risk commands pause for your approval before executing
- **Chain analysis** — detects multi-step attack patterns (read secrets → exfiltrate)
- **Adaptive memory** — learns from your approve/deny decisions, auto-adjusts risk scores over time
- **Multi-platform** — works with OpenClaw, Claude Code, and nanobot
- **Completely private** — local LLMs only, zero cloud APIs, your data never leaves

## Quick Start

### Prerequisites

- [LM Studio](https://lmstudio.ai) or [Ollama](https://ollama.ai) running locally
- [OpenClaw](https://github.com/openclaw/openclaw), [Claude Code](https://docs.anthropic.com/en/docs/claude-code), or [nanobot](https://github.com/HKUDS/nanobot)

**Recommended model:** `qwen/qwen3-4b-2507` — fast (~2s/call), 100% accuracy

### Install & Run

```bash
git clone https://github.com/TobyGE/GuardClaw.git
cd GuardClaw
npm install && npm install --prefix client && npm run build
npm link

guardclaw config detect-token --save   # auto-detect OpenClaw token
guardclaw start                        # opens dashboard at localhost:3002
```

That's it. GuardClaw connects to your agent platform and starts monitoring immediately.

### Enable Full Tool Monitoring (OpenClaw)

By default only chat events are visible. To see **every** tool call (read, write, exec…):

```bash
bash scripts/patch-openclaw.sh    # safe, idempotent — patches, rebuilds, restarts
```

> **What this does:** Adds one line to OpenClaw's WebSocket broadcast so tool events reach all connected clients. GuardClaw is a passive observer — this is the only way to receive tool events without interfering with the agent.

### Enable Active Blocking (Optional)

By default GuardClaw is **monitor-only**. To block dangerous commands before they run:

```bash
guardclaw plugin install       # install the OpenClaw plugin
openclaw gateway restart       # restart to load the plugin
```

| | Monitor Only | With Plugin |
|---|---|---|
| Risk scores + audit trail | ✅ | ✅ |
| Real-time tool call visibility | ✅ | ✅ |
| Block dangerous commands | ❌ | ✅ |
| Approval prompts for high-risk | ❌ | ✅ |

Once installed, toggle blocking on/off from the dashboard 🛡️ button — no restart needed.

### Claude Code Integration

GuardClaw works with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) via its HTTP hooks system — no OpenClaw required.

```bash
# Install the Claude Code hooks (writes to ~/.claude/settings.json)
node scripts/install-claude-code.js

# Start GuardClaw
guardclaw start
```

Every Bash, Read, Write, and Edit command in Claude Code is now risk-scored before execution. High-risk commands pause in the terminal while you approve/deny from the GuardClaw dashboard.

The dashboard shows Claude Code sessions in a dedicated tab with full conversation context — user prompts, agent replies, and all tool calls grouped into turns.

To uninstall: `node scripts/install-claude-code.js --uninstall`

## How It Works

```
┌─────────────┐     tool call      ┌──────────────┐     risk score     ┌─────────────┐
│   AI Agent   │ ─────────────────→ │  GuardClaw   │ ──────────────────→ │  Dashboard  │
│  (OpenClaw)  │                    │   Server     │                     │   Web UI    │
└─────────────┘                    │              │                     └─────────────┘
                                    │  ┌────────┐  │
                                    │  │Local   │  │
                                    │  │LLM     │  │  ← LM Studio / Ollama
                                    │  └────────┘  │
                                    └──────────────┘
```

1. **Agent acts** — OpenClaw sends tool events via WebSocket
2. **GuardClaw scores** — each tool call is analyzed by a local LLM judge
3. **You see everything** — real-time dashboard with risk scores, summaries, and full details
4. **Optionally block** — with the plugin installed, dangerous commands pause for approval

### Risk Tiers

| Verdict | Score | Action | Examples |
|---------|-------|--------|----------|
| ✅ **SAFE** | 1–3 | Runs freely | `cat`, `grep`, `git commit`, `npm build` |
| ⚠️ **WARNING** | 4–7 | Runs freely, logged | `kill`, `rm -rf node_modules`, `chmod`, `curl POST` |
| 🛑 **BLOCK** | 8–10 | Paused for approval | `sudo`, `rm -rf /`, `curl \| bash`, writing to `~/.ssh/` |

## Dashboard Guide

### Header Bar

| Element | Description |
|---------|-------------|
| **Stats cards** (Safe / Warning / Block / Total) | Click any card to filter the event list by that risk tier |
| **Days Protected** | How long GuardClaw has been watching |
| **Blocking toggle** | Enable/disable active blocking (requires plugin) |
| **Fail-closed toggle** | When ON, tools are blocked if GuardClaw goes offline |
| 📡 **Blocking config** | Set blocking mode, threshold, whitelist/blacklist patterns |
| **Settings** | LLM backend, model selection, gateway token config |
| **Benchmark** | Run accuracy tests against any loaded model |
| **Theme** | Toggle dark/light mode |

### Event List

Events are grouped into **conversation turns** — each turn shows the agent's tool calls bundled together with the final reply.

- **Agent turn** — a completed agent response with its tool calls
- **Agent working…** — tool calls in progress (no reply yet)
- Click **Details** on any tool call to see full input/output, risk analysis, and chain context
- **Session tabs** at the top let you switch between the main agent and any sub-agents

### Settings

**Gateway tab:**
- Enter your OpenClaw/nanobot gateway token manually, or click **Auto-Detect** to find it

**LLM tab:**
- Switch between **LM Studio** and **Ollama** backends
- Browse and select from all loaded models
- Recommended models are marked with a recommended badge

### Benchmark

Test any model's security judgment accuracy:
- **30 tool-trace test cases** covering safe operations, warnings, and dangerous commands
- Pick any model from LM Studio or Ollama
- Real-time progress via streaming
- Results show accuracy %, false positives, false negatives, and average latency

### Blocking Config (📡)

- **Active Blocking** — dangerous commands (score ≥ threshold) are paused; agent gets a notification and waits for `/approve-last` or `/deny-last`
- **Monitor Only** — everything runs freely, risk scores are logged for review
- **Whitelist** — patterns that always pass (e.g., `git *`, `npm test`)
- **Blacklist** — patterns that always block (e.g., `rm -rf /`, `curl | bash`)

## Active Blocking Details

> See [Quick Start → Enable Active Blocking](#enable-active-blocking-optional) for installation.

### Approval Workflow

When a tool is blocked:
1. You receive a notification with the tool name, input, risk score, and reason
2. Reply `/approve-last` to allow execution (agent auto-retries)
3. Reply `/deny-last` to reject (agent is informed)

## CLI Reference

```bash
guardclaw start                       # start server + open dashboard
guardclaw stop                        # stop server

guardclaw config detect-token --save  # auto-detect gateway token
guardclaw config set-token <token>    # manually set token

guardclaw plugin install              # install blocking plugin
guardclaw plugin uninstall            # remove blocking plugin
guardclaw plugin status               # check plugin state

guardclaw help                        # show all commands
```

## Architecture Highlights

- **Local LLM judge** — per-model prompt configs optimized for small models (qwen3-4b default)
- **Chain analysis** — tracks tool sequences per session, detects multi-step exfiltration patterns
- **SQLite persistence** — events survive restarts (WAL mode, indexed queries)
- **SSE push** — real-time event streaming to the dashboard, no polling
- **Async analysis** — events appear instantly, LLM scores update in the background
- **Prompt injection defense** — chain history wrapped in XML tags to prevent manipulation
- **Sub-agent monitoring** — each sub-agent session gets independent chain analysis

## Memory System

GuardClaw learns from your decisions. Approve/deny actions are recorded as generalized patterns (`curl https://api.notion.com/*`, `cat ~/.ssh/*`), and future risk scores adjust automatically. After enough consistent approvals, similar commands skip the LLM judge entirely.

Use **Mark Safe** / **Mark Risky** buttons on any tool call in the dashboard to train memory directly. Scores ≥ 9 are never auto-approved. View learned patterns in the Memory tab.

## Roadmap

See the [full roadmap](docs/ROADMAP.md) for detailed feature descriptions.

**Coming up:**
- Event search & advanced filtering
- Cross-session chain analysis
- A2A protocol monitoring

**Recently completed (Feb 2026):**
**Claude Code integration** (HTTP hooks + dashboard tab + approval workflow) · Adaptive memory system · Human feedback (Mark Safe/Risky) · Auto-approve by memory · Memory dashboard · Smart pattern extraction · SQLite persistence · SSE real-time push · in-dashboard model benchmark · 3-tier verdict system (100% accuracy) · dark mode polish · server modularization · blocking config UI

## Links

- [OpenClaw](https://github.com/openclaw/openclaw) · [nanobot](https://github.com/HKUDS/nanobot) · [LM Studio](https://lmstudio.ai)
- [Full Roadmap](docs/ROADMAP.md) · [Troubleshooting](docs/LMSTUDIO-TROUBLESHOOTING.md)

---

<p align="center">
  <sub>Built with paranoia and local LLMs. Your data never leaves your machine. </sub>
</p>
