# GuardClaw 🛡️🐾

## Local LLM-powered security monitoring for AI agents

GuardClaw analyzes every AI agent command in real-time using **local LLMs**
(LM Studio/Ollama). Get context-aware risk scores, detailed reasoning, and
complete audit trails—**100% private, zero cloud costs**.

![GuardClaw Dashboard](docs/screenshots/dashboard.jpg?v=1552)

## Why GuardClaw?

- 🧠 **Context-aware** - Understands intent, not just patterns
- 🔒 **100% local** - Your data never leaves your machine
- ⚡ **Real-time** - Analyzes as commands execute
- 📊 **Risk scoring** - 0-10 scale with detailed reasoning
- 📋 **Step-by-step** - See every thinking block, tool call, and execution
- 🎯 **Smart filtering** - Click to filter by risk level or backend

## Quick Start

**Prerequisites:**

- [LM Studio](https://lmstudio.ai) running on `localhost:1234` (or [Ollama](https://ollama.ai))
- An AI agent: [OpenClaw](https://github.com/openclaw/openclaw) or [nanobot](https://github.com/HKUDS/nanobot)

**Install:**

```bash
git clone https://github.com/TobyGE/GuardClaw.git
cd GuardClaw
npm install
npm install --prefix client
npm run build
npm link
```

**Configure & Start:**

```bash
# Auto-detect OpenClaw token
guardclaw config detect-token --save

# Start server (opens browser automatically)
guardclaw start
```

**Web UI Setup (easier):**

1. Run `guardclaw start`
2. Click ⚙️ **Settings** → **Gateway** tab
3. Click **🔍 Auto-Detect** → **Save & Reconnect**

Done! GuardClaw is now monitoring your agent.

> **Want active blocking?** Install the OpenClaw plugin to intercept dangerous
> commands before they run. See [Enable Command Blocking](#2-enable-command-blocking-openclaw-plugin) under Advanced Configuration.

## Essential Commands

```bash
# Server
guardclaw start              # Start server (auto-opens browser)
guardclaw stop               # Stop server

# Configuration
guardclaw config detect-token --save    # Auto-detect & save OpenClaw token
guardclaw config set-token <token>      # Set token manually
guardclaw config show                   # View all settings

# Utilities
guardclaw version            # Show version
guardclaw help               # Show help
```

## Configuration

GuardClaw auto-detects running backends (OpenClaw `:18789`, nanobot `:18790`).

**Optional `.env`:**

```env
OPENCLAW_TOKEN=your_token_here
SAFEGUARD_BACKEND=lmstudio           # lmstudio | ollama | anthropic
LMSTUDIO_URL=http://localhost:1234/v1
PORT=3001
```

Or use the **Settings panel** in the web UI for point-and-click configuration.

## Recommended Models

For LM Studio/Ollama (local):

- `llama-3.1-8b` - Fast and accurate
- `qwen-2.5-7b` - Multilingual support
- `openai/gpt-oss-20b` - Best balance
- `mistral-7b` - Strong reasoning

For small hardware (1.7B works too!):

- `qwen3-1.7b` - Optimized JSON parsing

## Safety Levels

- 🟢 **Safe (0-3)** - Execute immediately
- 🟡 **Warning (4-7)** - Show warning, require ack
- 🔴 **Blocked (8-10)** - Require explicit confirmation or auto-block

## Features

- **Web UI Settings** - Configure token & LLM backend in browser
- **Streaming Timeline** - Step-by-step analysis of AI decisions
- **Backend Selector** - Filter events by OpenClaw/nanobot
- **Dark/Light Mode** - Beautiful UI with theme toggle
- **Complete Audit Trail** - 500+ recent events with full history

## Using with nanobot

```bash
# Terminal 1: Start nanobot
nanobot gateway

# Terminal 2: Start GuardClaw
guardclaw start
```

GuardClaw auto-connects to nanobot's monitoring server on `:18790`.

## 🔧 Advanced Configuration

**Note:** These features are independent—you can enable either or both depending on your needs.

### 1. Enable Tool Event Monitoring (OpenClaw)

By default, GuardClaw receives text events but **not tool execution events**
(read/write/exec). To enable full monitoring, patch OpenClaw to broadcast
tool events to all clients:

**Modify OpenClaw source:**

Edit `~/openclaw/src/gateway/server-chat.ts` (around line 370):

```typescript
// Find this block:
if (isToolEvent) {
  const recipients = toolEventRecipients.get(evt.runId);
  if (recipients && recipients.size > 0) {
    broadcastToConnIds("agent", toolPayload, recipients);
  }
  // ADD THIS LINE ↓
  broadcast("agent", toolPayload);
}
```

**Rebuild and restart:**

```bash
cd ~/openclaw
npm run build
node ~/openclaw/openclaw.mjs gateway restart
```

**Why this works:** OpenClaw originally only sends tool events to clients that
start agent runs. GuardClaw is a **passive observer** and shouldn't start runs.
This one-line patch broadcasts tool events to all WebSocket clients with the
`tool-events` capability.

**Verify:** Check GuardClaw's Streaming Steps—you should now see read/write/exec with full input/output details.

### 2. Enable Command Blocking (OpenClaw Plugin)

By default, GuardClaw is a **passive observer**: it shows you risk scores and
reasoning, but cannot stop a command from running. If you want GuardClaw to
actually *intercept* dangerous tool calls before they execute, install the
OpenClaw interceptor plugin.

#### Without the plugin (Monitor Only)

- ✅ Full dashboard with risk scores, reasoning, and audit trail
- ✅ See every tool call, exec command, file read/write in real time
- ✅ Zero impact on agent behavior — pure observation
- ❌ Cannot block or pause dangerous commands

#### With the plugin (Active Blocking)

- ✅ Everything above, plus:
- 🛡️ **Pre-execution interception** — dangerous commands are blocked *before* they run
- ⚠️ **Approval prompts** — medium-risk commands pause and ask you: `/approve-last` or `/deny-last`
- 🎛️ **One-click toggle** — enable/disable blocking from the Dashboard shield icon
- 📋 `/pending` — see all commands currently waiting for your decision

#### Install

```bash
# Install the plugin (copies files + updates openclaw.json)
guardclaw plugin install

# Restart OpenClaw Gateway to activate
openclaw gateway restart
```

That's it. The plugin lives at `~/.openclaw/plugins/guardclaw-interceptor/`
and is registered automatically.

#### Manage

```bash
guardclaw plugin status      # Check if installed and enabled
guardclaw plugin uninstall   # Remove plugin + clean up config
```

You can also toggle blocking on/off at any time from the GuardClaw Dashboard
without restarting anything — the shield 🛡️ button (left of Settings) controls
both the local LLM analysis and the OpenClaw plugin in sync.

#### How blocking works

When the plugin is enabled, every tool call goes through this flow:

```
Agent wants to run a tool
        ↓
OpenClaw plugin hooks before_tool_call
        ↓
GuardClaw LLM scores the risk (0–10)
        ↓
  Score ≤ 6  →  Allow automatically
  Score 7–8  →  Block + ask user (/approve-last or /deny-last)
  Score ≥ 9  →  Block automatically, no prompt
```

Thresholds and whitelist/blacklist patterns are configurable from the
Dashboard → 🛡️ Blocking Configuration.

## Tech Stack

Node.js + Express + WebSocket + React + LM Studio (local LLM)

## License

**Dual License:**

- FREE for personal/educational/open-source use
- Paid commercial license required for business use

See [LICENSE](LICENSE) for details.

## Links

- [Detailed Setup Guide](docs/LMSTUDIO-TROUBLESHOOTING.md)
- [OpenClaw](https://github.com/openclaw/openclaw)
- [nanobot](https://github.com/HKUDS/nanobot)
- [LM Studio](https://lmstudio.ai)
