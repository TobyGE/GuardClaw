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

### Security Coverage
- [x] **Chained tool analysis** — detect dangerous sequences rather than isolated calls (e.g. `web_fetch` → `exec`, `read(sensitive file)` → `message`). Each session maintains a rolling tool history (inputs + outputs); when an exit-type tool fires, the full trace is sent to the LLM in one call for holistic judgment.
- [x] **`write`/`edit` path analysis** — rule-based fast path for persistence/backdoor paths: `authorized_keys`, shell startup files (`.bashrc`/`.zshrc`/`.profile` etc), AWS credentials, cron, macOS LaunchAgents/Daemons, git hooks, system paths. Score 9, no LLM call needed.
- [ ] **`sessions_send` analysis** — cross-session message injection; an agent can send instructions into other sessions.
- [x] **Tool result inspection** — covered by chained tool analysis: tool outputs (including secrets/PII) are stored in session history via `after_tool_call`; when a `message` or `exec` fires, the LLM sees the full trace including prior outputs and judges whether data is being exfiltrated.
- [ ] **`canvas eval` analysis** — arbitrary JavaScript execution is currently unscored.
- [ ] **`nodes invoke` analysis** — commands sent to paired physical devices (phones, servers) should be treated as high-risk.

### Visibility
- [ ] **Sub-agent tracking** — `sessions_spawn` creates child agents in separate sessions. Link child sessions to their parent in the dashboard so dangerous activity in sub-agents is visible in context.

### UX
- [ ] **Approve/deny buttons in GuardClaw dashboard** — click instead of typing `/approve-last`.
- [ ] **Batch approval** — when multiple tool calls in a run are similar, offer approve-all.

## Links

- [OpenClaw](https://github.com/openclaw/openclaw) · [nanobot](https://github.com/HKUDS/nanobot) · [LM Studio](https://lmstudio.ai)
- [Troubleshooting](docs/LMSTUDIO-TROUBLESHOOTING.md)
