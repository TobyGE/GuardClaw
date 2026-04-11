# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GuardClaw is an AI agent safety monitor that sits between AI agents (Claude Code, OpenClaw, nanobot) and their tools. It uses a local LLM to risk-score every tool call in real time, auto-approving safe operations and flagging/blocking dangerous ones. Risk scores range 1–10: 1–3 = SAFE, 4–7 = WARNING, 8–10 = HIGH RISK.

## Commands

### Setup
```bash
npm install && npm install --prefix client && npm run build
npm link  # to use `guardclaw` CLI globally
```

### Development
```bash
npm run dev           # Run server (nodemon) + client (Vite) concurrently
npm run server:dev    # Server only (nodemon, auto-restart)
npm run client:dev    # Client only (Vite dev server at :5173)
npm run build         # Build React client to client/dist/
```

### Running
```bash
npm start             # Start server directly (node server/index.js)
guardclaw start       # Start via CLI (also opens browser at :3002)
guardclaw stop        # Stop server
```

### Claude Code integration
```bash
node scripts/install-claude-code.js            # Install hooks into ~/.claude/settings.json
node scripts/install-claude-code.js --uninstall
```

Unit tests live in `test/*.test.js` and run via `npm test` (`node --test`). Manual dev benchmark scripts live in `scripts/benchmarks/` (`test-4b.js`, `accuracy-test.js`, `gpt-oss-accuracy.js`) — run from the repo root so `dotenv` finds `.env`. The integration smoke test is `scripts/smoke-test.sh`.

## Architecture

The entire codebase uses ESM (`"type": "module"`). Node >= 18 required.

### Backend (`server/`)
Node.js Express server on port 3002.

- **`server/index.js`** — Main entry point. Wires all services, registers all Express routes, handles Claude Code HTTP hook endpoints (`/api/cc/pre-tool`, `/api/cc/post-tool`, `/api/cc/prompt`, `/api/cc/stop`), and manages the SSE push endpoint (`GET /api/events`) for the dashboard. The `/api/evaluate` endpoint (called by the OpenClaw plugin) is the **primary path** for storing tool-call events — it evaluates risk AND persists the event in one step. The evaluation cache (60s TTL) prevents the WebSocket streaming path from creating duplicate events. Loads `blocking-config.json` from the data dir on startup.

- **`server/safeguard.js`** — Core LLM risk scoring engine. Three fast paths before LLM: `HIGH_RISK_PATTERNS` (regex → instant score 9), safe fast-path (skip LLM, score 1), and sensitive read paths (`.ssh`, `.aws`, `.gnupg`, etc. → score 7–8). Supports backends: `lmstudio`, `ollama`, `anthropic`, `built-in`, `fallback` (deterministic rules only). `analyzeAction()` dispatches to `analyzeCommand()` for exec tools and `analyzeToolAction()` for all others (read, write, edit, web_fetch, glob, grep, agent_spawn, skill, worktree, etc.).

- **`server/llm-engine.js`** — Built-in LLM engine for the `built-in` backend. Spawns `mlx_lm.server` subprocess on port 8081 using Apple Silicon MLX models. Manages a Python venv at `~/.guardclaw/venv/` and downloaded models at `~/.guardclaw/models/`. Also detects a bundled Python env inside a `.app` bundle.

- **`server/approval-handler.js`** — Decision engine for OpenClaw blocking. Checks whitelist/blacklist from `blocking-config.json`, then applies configurable thresholds (`GUARDCLAW_AUTO_ALLOW_THRESHOLD`, `GUARDCLAW_ASK_THRESHOLD`, `GUARDCLAW_AUTO_BLOCK_THRESHOLD`) to decide auto-allow, ask user, or auto-block.

- **`server/event-store.js`** — SQLite persistence via `better-sqlite3` (WAL mode). Stores all tool call events in `.guardclaw/events.db`.

- **`server/memory.js`** — SQLite-backed adaptive memory in `.guardclaw/memory.db`. Records user approve/deny decisions as generalized patterns; repeated approvals eventually skip LLM.

- **`server/clawdbot-client.js`** — WebSocket client for the OpenClaw gateway. Manages ED25519 device identity at `~/.guardclaw/identity/device.json`, signs auth challenges, handles auto-reconnect.

- **`server/nanobot-client.js`** — WebSocket client for nanobot gateway.

- **`server/helpers.js`** — Stateless event processing utilities: `shouldSkipEvent`, `shouldAnalyzeEvent`, `extractAction`, `classifyNonExecEvent`, `parseEventDetails`, `isExecCommand`, `extractCommand`.

- **`server/streaming-tracker.js`** — Tracks the last 10 tool calls per session (up to 100 sessions) for chain analysis. Used to detect multi-step exfiltration (e.g. read `~/.ssh/id_rsa` → `curl evil.com`).

- **`server/benchmark.js`** / **`server/benchmark-store.js`** — 30-case accuracy benchmark runner and SQLite result store.

- **`server/data-dir.js`** — Returns `.guardclaw/` path under `process.cwd()`, creating it if needed.

- **`server/logger.js`** — Structured console logger with timestamps.

- **`server/install-tracker.js`** — Reads/writes `.guardclaw/install.json` (install date).

- **`server/routes/config.js`** — REST endpoints for LLM backend config, OpenClaw token management, fail-closed toggle, blocking toggle, and whitelist/blacklist management. Config changes update `.env` and reconnect clients without restart.

- **`server/routes/benchmark.js`** — REST endpoint to trigger benchmark runs.

- **`server/routes/models.js`** — REST endpoints for built-in model management: list, download, cancel, delete, load, unload, setup (download+load). SSE endpoint at `GET /api/models/progress` streams download progress.



### Frontend (`client/`)
React + Vite + Tailwind CSS. Built output served statically from `client/dist/`. In dev mode, Vite dev server at `:5173` proxies all `/api` requests to `:3002`.

Key data flow in `App.jsx`: SSE connection to `/api/events` drives all real-time updates (events, stats, sessions, connection status, LLM status, approval requests). `ApprovalBanner` handles pending approvals via a ref forwarded from the SSE handler.

### CLI (`bin/guardclaw.js`)
Handles `start`, `stop`, `config`, `plugin`, `update`, `version`, `help`. `guardclaw stop` finds and kills by grepping `ps aux` for `node.*guardclaw.*server/index.js`.

### Plugin (`plugin/guardclaw-interceptor/`)
OpenClaw plugin installed to `~/.openclaw/plugins/guardclaw-interceptor/`. Intercepts tool calls before execution and calls `/api/evaluate` on the GuardClaw server.

### Data directories
- **`.guardclaw/`** — Project-local (created in `process.cwd()`): `events.db`, `memory.db`, `blocking-config.json`, `install.json`.
- **`~/.guardclaw/`** — Global (user home): `identity/device.json` (ED25519 key), `models/` (downloaded MLX models), `venv/` (Python venv for mlx_lm).

## Environment Configuration

Copy `.env.example` to `.env`. Key variables:
- `SAFEGUARD_BACKEND` — `lmstudio` (default) | `ollama` | `anthropic` | `built-in` | `fallback`
- `LMSTUDIO_URL` — default `http://localhost:1234/v1`
- `LMSTUDIO_MODEL` — `auto` (recommended: `qwen/qwen3-4b-2507`)
- `OLLAMA_URL` / `OLLAMA_MODEL` — default `http://localhost:11434` / `llama3`
- `BACKEND` — `auto` | `openclaw` | `qclaw` | `nanobot` (controls which WebSocket clients activate)
- `PORT` — default `3002`
- `GUARDCLAW_APPROVAL_MODE` — `auto` | `prompt` | `monitor-only`
- `GUARDCLAW_AUTO_ALLOW_THRESHOLD` — default `6` (≤ this: auto-allow)
- `GUARDCLAW_ASK_THRESHOLD` — default `8` (≤ this in prompt mode: ask user)
- `GUARDCLAW_AUTO_BLOCK_THRESHOLD` — default `9` (≥ this: auto-block)

## Scoring Logic (key patterns in `safeguard.js`)

When adding new detection rules, understand the evaluation order:
1. `HIGH_RISK_PATTERNS` regex check → score 9, no LLM (e.g. `curl | bash`, `nc -e`, killing guardclaw)
2. `isClearlySafe()` fast-path → score 1, no LLM (allowlist of safe base commands + git/npm rules)
3. Sensitive read path check → score 7–8, no LLM
4. Cache lookup (1h TTL, skipped when chain history present)
5. LLM backend call (lmstudio / ollama / anthropic / built-in / fallback rules)

Chain history from `streaming-tracker` is injected into LLM prompts when a session has prior tool calls, enabling multi-step attack detection.

## OpenClaw vs Qclaw

Both are gateway-based AI agent frameworks. GuardClaw connects to either (or both) via WebSocket to monitor tool calls.

| | OpenClaw | Qclaw |
|---|---|---|
| **Gateway port** | `18789` | `28789` |
| **Config file** | `~/.openclaw/openclaw.json` | `~/.qclaw/openclaw.json` |
| **GuardClaw client** | `server/clawdbot-client.js` (`ClawdbotClient`) | `server/qclaw-client.js` (`QclawClient`) |
| **Plugin location** | `~/.openclaw/plugins/guardclaw-interceptor/` | `~/.qclaw/plugins/guardclaw-interceptor/` |
| **Pre-execution blocking** | Yes (via `plugin/guardclaw-interceptor/`) | No |
| **WebSocket monitoring** | Yes | Yes |

**OpenClaw** has two integration paths:
1. **Plugin** (`plugin/guardclaw-interceptor/index.js`): hooks `before_tool_call`, calls `POST /api/evaluate`, can **block** tool execution before it happens. This is the primary event-storage path.
2. **WebSocket stream** (`ClawdbotClient`): receives events from the gateway, used for monitoring and chain analysis.

**Qclaw** has only the WebSocket stream path — monitoring only, cannot block pre-execution.

Both share the same ED25519 device identity (`~/.guardclaw/identity/device.json`) and identical event protocol. The 60s evaluation cache in `server/index.js` prevents the WebSocket stream from creating duplicate events when the plugin already called `/api/evaluate`.
