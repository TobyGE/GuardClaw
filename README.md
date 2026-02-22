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
| 1 | [Chained tool analysis](#1-chained-tool-analysis) | ✅ Done | 2026-02-21 |
| 2 | [`write`/`edit` path analysis](#2-writeedit-path-analysis) | ✅ Done | 2026-02-21 |
| 3 | [Tool result inspection](#3-tool-result-inspection) | ✅ Done | 2026-02-21 |
| 4 | [`canvas eval` analysis](#4-canvas-eval-analysis) | ✅ Done | 2026-02-21 |
| 5 | [`nodes invoke` analysis](#5-nodes-invoke-analysis) | ✅ Done | 2026-02-21 |
| 6 | [Cross-session security tracking](#6-cross-session-security-tracking) | 🔲 Planned | — |
| 7 | [Fail-closed on GuardClaw disconnect](#7-fail-closed-on-guardclaw-disconnect) | 🔲 Planned | — |
| 8 | [Prompt injection defense on LLM judge](#8-prompt-injection-defense-on-llm-judge) | 🔲 Planned | — |
| 9 | [Write-file content scanning](#9-write-file-content-scanning) | 🔲 Planned | — |
| 10 | [Approve/deny buttons in dashboard](#10-approvedeny-buttons-in-dashboard) | 🔲 Planned | — |

---

#### 1. Chained tool analysis
Detect dangerous sequences rather than isolated calls (e.g. `web_fetch` → `exec`, `read(sensitive file)` → `message`). Each session maintains a rolling tool history (inputs + outputs); when an exit-type tool fires, the full trace is sent to the LLM in one call for holistic judgment.

#### 2. `write`/`edit` path analysis
Rule-based fast path for persistence/backdoor paths: `authorized_keys`, shell startup files (`.bashrc`/`.zshrc`/`.profile` etc), AWS credentials, cron, macOS LaunchAgents/Daemons, git hooks, system paths. Score 9, no LLM call needed.

#### 3. Tool result inspection
Covered by chained tool analysis: tool outputs (including secrets/PII) are stored in session history via `after_tool_call`; when a `message` or `exec` fires, the LLM sees the full trace including prior outputs and judges whether data is being exfiltrated.

#### 4. `canvas eval` analysis
`canvas` is excluded from the safe-tools fast path. Non-eval actions (`present`, `hide`, `navigate`, `snapshot`) → score 1 (rules). `eval` actions → full LLM analysis; prompt includes JS-specific risks (cookie/localStorage access, external `fetch`, `require`/`child_process`).

#### 5. `nodes invoke` analysis
Analyzed by LLM; scoring prompt includes nodes-specific guidance (screen recording / camera without consent → 8-9). Rule-based would over-block legitimate uses (e.g. taking a photo on request).

#### 6. Cross-session security tracking
`sessions_spawn` and `sessions_send` create multi-agent topologies that single-session chain analysis cannot see. A compromised agent can call `sessions_send` to inject instructions into a peer session (prompt injection lateral movement), or read sensitive data in session A and exfiltrate via session B. Planned fix: log injections at `sessions_send` time, tag agent-injected messages in the receiver's chain context (`[⚠️ INJECTED from agent:X]`), and show session spawn lineage as a tree in the dashboard. Cross-session history will be persisted to disk so GuardClaw restarts don't create blind spots.

#### 7. Fail-closed on GuardClaw disconnect
If the GuardClaw process crashes or the plugin loses its connection, tools currently execute unblocked (fail-open). Fix: plugin heartbeat to GuardClaw; if unreachable → block tool execution until connection is restored. GuardClaw will also record its own PID at startup and treat any `kill`/`pkill` targeting that PID as a score-9 rule-based block.

#### 8. Prompt injection defense on LLM judge
The rule-based layer only fast-paths *safe* tools; dangerous and ambiguous commands all go through the LLM judge. A malicious webpage fetched by the agent (low score, allowed) can embed adversarial text in the tool result that ends up in `chain_history` and manipulates the judge on a subsequent dangerous call. Fix: (1) wrap `chain_history` in XML tags with a system-prompt instruction to treat all content inside as raw data; (2) extend rule-based coverage for high-confidence dangerous patterns that should never reach the LLM (`nc`/`ncat` + external IP, `curl … | bash`, `base64 -d | bash`).

#### 9. Write-file content scanning
After a `write` tool call, scan the file with traditional tools before closing the event: images → StegDetect / stegoveritas (LSB steganography); text/binary → entropy analysis, `strings`, `binwalk`. Scan results are appended to the LLM judge prompt alongside chain context so the model can reason holistically. Catches base64/hex encoding in text files reliably; catches binary steganography when steganalysis tools are available.

#### 10. Approve/deny buttons in dashboard
Click instead of typing `/approve-last`.

## Links

- [OpenClaw](https://github.com/openclaw/openclaw) · [nanobot](https://github.com/HKUDS/nanobot) · [LM Studio](https://lmstudio.ai)
- [Troubleshooting](docs/LMSTUDIO-TROUBLESHOOTING.md)
