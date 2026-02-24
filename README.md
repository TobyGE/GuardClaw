# GuardClaw 🛡️🐾

Real-time security monitoring for AI agents — powered by local LLMs. Every tool call gets risk-scored before it runs. 100% private, zero cloud.

![GuardClaw Dashboard](docs/screenshots/dashboard.jpg?v=1552)

## Requirements

- [LM Studio](https://lmstudio.ai) or [Ollama](https://ollama.ai) running locally
- [OpenClaw](https://github.com/openclaw/openclaw) or [nanobot](https://github.com/HKUDS/nanobot)

**Recommended models:**
- `qwen/qwen3-4b-2507` — **default**, 100% accuracy on our 20-case security benchmark, fast (~2s/call)
- `openai/gpt-oss-20b` — 98% accuracy, richer reasoning, slower

## Install

```bash
git clone https://github.com/TobyGE/GuardClaw.git
cd GuardClaw
npm install && npm install --prefix client && npm run build
npm link
```

## Start

```bash
guardclaw config detect-token --save   # auto-detect OpenClaw token
guardclaw start                        # opens browser automatically
```

Or skip the CLI: run `guardclaw start`, go to ⚙️ Settings → Gateway → Auto-Detect.

## Advanced: Full Tool Event Monitoring (OpenClaw)

By default GuardClaw only receives text/chat events from OpenClaw. To see every tool call (read, write, exec, etc.) in real-time, run the included patch script:

```bash
bash scripts/patch-openclaw.sh
```

That's it. The script will patch OpenClaw, rebuild it, and restart the gateway automatically. It's safe to run multiple times (idempotent).

**What it does:** Adds one line to OpenClaw's WebSocket broadcast logic so that tool events are sent to all connected clients — not just ones that started an agent run. GuardClaw is a passive observer and this is the only way it can receive tool events without interfering with normal operation.

## Advanced: Active Blocking

By default GuardClaw is **monitor-only** — it shows risk scores but doesn't interfere with the agent.

Install the OpenClaw plugin to enable **pre-execution interception**:

| | Monitor only | With plugin |
|---|---|---|
| Risk scores + audit trail | ✅ | ✅ |
| Real-time tool call visibility | ✅ | ✅ |
| Block dangerous commands | ❌ | ✅ |
| Approval prompts for high-risk (score ≥ 8) | ❌ | ✅ |

```bash
guardclaw plugin install
openclaw gateway restart
```

Once enabled, the 🛡️ button in the Dashboard toggles blocking on/off without a restart. Every tool call is classified into one of three tiers:

| Verdict | Action | Examples |
|---------|--------|----------|
| **SAFE** | Runs freely | `cat`, `grep`, `git commit`, `npm build`, `curl localhost \| python3` |
| **WARNING** | Runs freely, logged for review | `kill`, `rm -rf node_modules`, `chmod`, `curl POST` |
| **BLOCK** | Paused, requires `/approve-last` or `/deny-last` | `sudo`, `rm -rf /`, `curl \| bash`, writing to `~/.ssh/` |

## Commands

```bash
guardclaw start / stop
guardclaw config detect-token --save
guardclaw config set-token <token>
guardclaw plugin install / uninstall / status
guardclaw help
```

## Roadmap / TODO

**Core Analysis**

| Feature | Status | Date |
|---------|--------|------|
| [Real-time tool event monitoring](docs/ROADMAP.md#real-time-tool-event-monitoring) | ✅ Done | 2026-02-15 |
| [Risk scoring with local LLM](docs/ROADMAP.md#risk-scoring-with-local-llm) | ✅ Done | 2026-02-15 |
| [Safe-tool fast path — skip LLM for clearly safe tools](docs/ROADMAP.md#safe-tool-fast-path) | ✅ Done | 2026-02-20 |
| [Per-model prompt configs (qwen3-4b / 1.7b / 0.5b / gpt-oss)](docs/ROADMAP.md#per-model-prompt-configs) | ✅ Done | 2026-02-20 |
| [3-tier verdict system (SAFE/WARNING/BLOCK) — 98% accuracy](docs/ROADMAP.md#3-tier-verdict-system) | ✅ Done | 2026-02-24 |
| [`message` tool privacy analysis](docs/ROADMAP.md#message-tool-privacy-analysis) | ✅ Done | 2026-02-20 |
| [Chained tool analysis](docs/ROADMAP.md#chained-tool-analysis) | ✅ Done | 2026-02-21 |
| [`write`/`edit` path analysis — persistence & backdoor detection](docs/ROADMAP.md#writeedit-path-analysis) | ✅ Done | 2026-02-21 |
| [Tool result inspection via `after_tool_call`](docs/ROADMAP.md#tool-result-inspection) | ✅ Done | 2026-02-21 |
| [`canvas eval` analysis](docs/ROADMAP.md#canvas-eval-analysis) | ✅ Done | 2026-02-21 |
| [`nodes invoke` analysis](docs/ROADMAP.md#nodes-invoke-analysis) | ✅ Done | 2026-02-21 |
| [Prompt injection defense on LLM judge](docs/ROADMAP.md#prompt-injection-defense-on-llm-judge) | ✅ Done | 2026-02-22 |
| [Sub-agent monitoring — independent chain analysis per session](docs/ROADMAP.md#sub-agent-monitoring) | ✅ Done | 2026-02-22 |
| [Write/Edit content scanning](docs/ROADMAP.md#writeedit-content-scanning--expanded-secret-detection) | ✅ Done | 2026-02-22 |

**Active Blocking**

| Feature | Status | Date |
|---------|--------|------|
| [Approval workflow (`/approve-last` / `/deny-last`)](docs/ROADMAP.md#approval-workflow) | ✅ Done | 2026-02-15 |
| [OpenClaw plugin — pre-execution interception](docs/ROADMAP.md#openclaw-plugin--pre-execution-interception) | ✅ Done | 2026-02-20 |
| [One-click blocking toggle in dashboard](docs/ROADMAP.md#one-click-blocking-toggle) | ✅ Done | 2026-02-20 |
| [Auto-retry after approval — no re-typing needed](docs/ROADMAP.md#auto-retry-after-approval) | ✅ Done | 2026-02-20 |
| [Direct user notification on block](docs/ROADMAP.md#direct-user-notification-on-block) | ✅ Done | 2026-02-20 |
| [Run-level lock — single notification per run](docs/ROADMAP.md#run-level-lock) | ✅ Done | 2026-02-20 |
| [Fail-closed on GuardClaw disconnect](docs/ROADMAP.md#fail-closed-on-guardclaw-disconnect) | ✅ Done | 2026-02-22 |
| [Fail-closed dashboard toggle](docs/ROADMAP.md#fail-closed-dashboard-toggle) | ✅ Done | 2026-02-22 |
| [Monitor/Blocking mode toggle](docs/ROADMAP.md#monitor-blocking-mode-toggle) | ✅ Done | 2026-02-22 |


**Dashboard & UX**

| Feature | Status | Date |
|---------|--------|------|
| [Days Protected tracking](docs/ROADMAP.md#days-protected-tracking) | ✅ Done | 2026-02-11 |
| [Light / dark mode](docs/ROADMAP.md#light--dark-mode) | ✅ Done | 2026-02-11 |
| [AI-powered event summaries](docs/ROADMAP.md#ai-powered-event-summaries) | ✅ Done | 2026-02-15 |
| [Click-to-filter stats cards](docs/ROADMAP.md#click-to-filter-stats-cards) | ✅ Done | 2026-02-15 |
| [Auto-open browser on start](docs/ROADMAP.md#auto-open-browser-on-start) | ✅ Done | 2026-02-15 |
| [Conversation turn grouping in event list](docs/ROADMAP.md#conversation-turn-grouping) | ✅ Done | 2026-02-20 |
| [Session tabs — separate views for main agent and sub-agents](docs/ROADMAP.md#session-tabs) | ✅ Done | 2026-02-22 |

**Integration & Setup**

| Feature | Status | Date |
|---------|--------|------|
| [nanobot support](docs/ROADMAP.md#nanobot-support) | ✅ Done | 2026-02-13 |
| [Web UI + CLI configuration management](docs/ROADMAP.md#web-ui--cli-configuration-management) | ✅ Done | 2026-02-15 |
| [LLM backend config UI — LM Studio + Ollama](docs/ROADMAP.md#llm-backend-config-ui) | ✅ Done | 2026-02-15 |
| [`patch-openclaw.sh` — one-command OpenClaw patching](docs/ROADMAP.md#patch-openclawsh) | ✅ Done | 2026-02-20 |

**Future**

| Feature | Notes |
|---------|-------|
| Cross-session chain analysis | Parent→child chain history sharing. Low priority — per-session monitoring already covers most scenarios. |
| A2A (Agent-to-Agent) protocol monitoring | Monitor inter-agent communication. Waiting for broader A2A adoption in OpenClaw. |
| Approve/deny buttons in dashboard | Frontend buttons for `/approve-last` and `/deny-last`. Backend already exists. |

→ [Full details for each feature](docs/ROADMAP.md)

## Links

- [OpenClaw](https://github.com/openclaw/openclaw) · [nanobot](https://github.com/HKUDS/nanobot) · [LM Studio](https://lmstudio.ai)
- [Troubleshooting](docs/LMSTUDIO-TROUBLESHOOTING.md)
