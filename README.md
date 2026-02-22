# GuardClaw 🛡️🐾

Real-time security monitoring for AI agents — powered by local LLMs. Every tool call gets risk-scored before it runs. 100% private, zero cloud.

![GuardClaw Dashboard](docs/screenshots/dashboard.jpg?v=1552)

## Requirements

- [LM Studio](https://lmstudio.ai) or [Ollama](https://ollama.ai) running locally
- [OpenClaw](https://github.com/openclaw/openclaw) or [nanobot](https://github.com/HKUDS/nanobot)

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

Once enabled, the 🛡️ button in the Dashboard toggles blocking on/off without a restart. Tools with a risk score ≥ 8 are paused and require human approval — respond with `/approve-last` or `/deny-last`. Below 8, tools run freely and risk scores are logged in the dashboard.

## Commands

```bash
guardclaw start / stop
guardclaw config detect-token --save
guardclaw config set-token <token>
guardclaw plugin install / uninstall / status
guardclaw help
```

## Roadmap / TODO

| # | Feature | Status | Completed |
|---|---------|--------|-----------|
| 1 | [Chained tool analysis](docs/ROADMAP.md#1-chained-tool-analysis) | ✅ Done | 2026-02-21 |
| 2 | [`write`/`edit` path analysis](docs/ROADMAP.md#2-writeedit-path-analysis) | ✅ Done | 2026-02-21 |
| 3 | [Tool result inspection](docs/ROADMAP.md#3-tool-result-inspection) | ✅ Done | 2026-02-21 |
| 4 | [`canvas eval` analysis](docs/ROADMAP.md#4-canvas-eval-analysis) | ✅ Done | 2026-02-21 |
| 5 | [`nodes invoke` analysis](docs/ROADMAP.md#5-nodes-invoke-analysis) | ✅ Done | 2026-02-21 |
| 6 | [Cross-session security tracking](docs/ROADMAP.md#6-cross-session-security-tracking) | 🔲 Planned | — |
| 7 | [Fail-closed on GuardClaw disconnect](docs/ROADMAP.md#7-fail-closed-on-guardclaw-disconnect) | 🔲 Planned | — |
| 8 | [Prompt injection defense on LLM judge](docs/ROADMAP.md#8-prompt-injection-defense-on-llm-judge) | 🔲 Planned | — |
| 9 | [Write-file content scanning](docs/ROADMAP.md#9-write-file-content-scanning) | 🔲 Planned | — |
| 10 | [Approve/deny buttons in dashboard](docs/ROADMAP.md#10-approvedeny-buttons-in-dashboard) | 🔲 Planned | — |

→ [Full roadmap with details](docs/ROADMAP.md)

## Links

- [OpenClaw](https://github.com/openclaw/openclaw) · [nanobot](https://github.com/HKUDS/nanobot) · [LM Studio](https://lmstudio.ai)
- [Troubleshooting](docs/LMSTUDIO-TROUBLESHOOTING.md)
