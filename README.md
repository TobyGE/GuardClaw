# GuardClaw 🛡️🐾

## Local LLM-Powered Generative Safety for AI Agents

GuardClaw brings **generative AI safety analysis** to your AI agents using
**local LLMs** (LM Studio, Ollama). Every command, file operation, and chat
message is analyzed by a local language model that understands context,
intent, and risk—**without sending any data to the cloud**.

## 🌟 Core Feature: Generative Safety Powered by LM Studio

Unlike traditional rule-based security tools, GuardClaw uses **LM Studio** to
run local language models that provide intelligent, context-aware safety
analysis:

- 🧠 **Context-Aware Analysis** - Understands the full context of commands,
  not just pattern matching
- 🔒 **100% Local via LM Studio** - All analysis runs on your machine through
  LM Studio's local inference server
- 🎯 **Intent Understanding** - Distinguishes between `echo "password=test"`
  (safe) and actual credential leaks
- 📊 **Risk Scoring 0-10** - Nuanced risk assessment with detailed reasoning
  from your local LLM
- 💬 **Natural Language Explanations** - Every decision comes with
  human-readable reasoning
- ⚡ **Real-time Protection** - Analyzes exec commands, file operations, and
  chat messages as they happen

### Why LM Studio + Local LLMs?

- ✅ **Zero Cloud Costs** - No API fees, runs completely offline
- ✅ **Complete Privacy** - Your commands and data never leave your machine
- ✅ **Model Flexibility** - Use any GGUF model (Llama, Mistral, Qwen, etc.)
- ✅ **Fast Inference** - No network latency, instant analysis
- ✅ **Easy Setup** - Download LM Studio, load a model, done!

### Recommended Models for LM Studio

- `llama-3.1-8b` - Fast and accurate for most use cases
- `mistral-7b` - Excellent reasoning capabilities
- `qwen-2.5-7b` - Strong multilingual support
- `openai/gpt-oss-20b` - Balanced performance and quality

## What GuardClaw Does

- 📊 **Real-time Monitoring** - Live event stream of all agent activities
- 🛡️ **Generative Safety Analysis** - Every action analyzed by your local LLM
- 🔍 **Detailed Insights** - Risk scores, categories, and reasoning for each
  event
- 📝 **Complete Audit Trail** - Full execution history with security
  annotations

## Screenshot

![GuardClaw Dashboard](docs/screenshots/dashboard.jpg)

**Dashboard Features:**
- 📊 **Real-time Stats** - Days protected, total events, safe commands, warnings, and blocked operations
- 🎯 **Click-to-Filter** - Click any stat card (Safe/Warning/Blocked) to filter events by risk level
- 🌓 **Light/Dark Mode** - Toggle between themes with one click
- 🔗 **Connection Status** - Click Gateway/LLM badges to view detailed connection info
- 📋 **Live Event Stream** - Security analysis with risk scores and detailed LLM reasoning
- 🔍 **Expandable Details** - Click events to see full command analysis with backend information
- 💾 **Persistent History** - Up to 500 recent events with full audit trail

## Prerequisites ⚠️

Before installing GuardClaw, you need:

### 1. **LM Studio** (Required for local AI analysis)

Download and install [LM Studio](https://lmstudio.ai):
- **macOS/Windows/Linux** - Free download from lmstudio.ai
- Load a model (recommended: `mistral-7b-instruct`, `llama-3.1-8b`, or `qwen-2.5-7b`)
- Start the local server (default: `http://localhost:1234`)

**Why?** GuardClaw uses LM Studio's local LLM to analyze command safety with zero cloud costs and complete privacy.

### 2. **An Agent Backend** (at least one required)

GuardClaw supports multiple agent backends. You need at least one:

**Option A: OpenClaw Gateway**

Install [OpenClaw](https://github.com/openclaw/openclaw):
```bash
npm install -g clawdbot@latest
clawdbot gateway start
```

**Option B: Nanobot**

Install [nanobot](https://github.com/HKUDS/nanobot) (v0.1.3+):
```bash
pip install nanobot-ai
nanobot gateway
```

Nanobot's built-in monitoring server starts automatically on port `18790`
when you run `nanobot gateway`. No extra configuration needed.

### 3. **Node.js ≥18** (Required runtime)

Check your version: `node --version`

---

## Quick Start (TL;DR)

**Step 1**: Start LM Studio server (http://localhost:1234)

**Step 2**: Clone and install GuardClaw
```bash
git clone https://github.com/TobyGE/GuardClaw.git
cd GuardClaw
npm install
npm install --prefix client  # Install client dependencies
npm run build                # Build web UI
npm link                     # Makes 'guardclaw' command available globally
```

**Step 3**: Start GuardClaw
```bash
guardclaw start
```

**Step 4**: Configure (choose one method)

**Method A - Web UI (easiest):**
1. Browser opens automatically at `http://localhost:3001`
2. Click ⚙️ **Settings** button (top right)
3. Click **🔍 Auto-Detect** to find OpenClaw token
4. Click **Save & Reconnect** - done!

**Method B - CLI (fastest):**
```bash
guardclaw config detect-token --save
guardclaw stop && guardclaw start
```

That's it! GuardClaw auto-detects running backends (OpenClaw on `:18789`,
nanobot on `:18790`) and analyzes commands via LM Studio.

## Installation

### From Source (Recommended)

```bash
git clone https://github.com/TobyGE/GuardClaw.git
cd GuardClaw
npm install
npm install --prefix client
npm run build
npm link
```

The `npm link` command creates a global symlink, making the `guardclaw` command available system-wide.

### Update to Latest Version

```bash
cd GuardClaw
git pull
npm install
```

### Alternative: Install Locally Without Global Command

If you don't want to use `npm link`:

```bash
git clone https://github.com/TobyGE/GuardClaw.git
cd GuardClaw
npm install
npm start  # Or use npm scripts directly
```

## Using with Nanobot

GuardClaw monitors nanobot tool executions (shell commands, file writes, web
requests, etc.) with the same safety analysis and risk scoring as OpenClaw
agents.

### Quick Start (nanobot)

```bash
# Terminal 1: Start nanobot gateway (monitoring server starts on :18790)
nanobot gateway

# Terminal 2: Start GuardClaw
cd GuardClaw
npm start

# Terminal 3 (optional): Send a message to trigger tool use
nanobot agent -m "list the files in my home directory"
```

Open `http://localhost:3001` — you'll see nanobot's tool calls appear in the
dashboard with risk scores.

### How It Works

When `nanobot gateway` starts, a lightweight WebSocket monitoring server
runs on port `18790`. It wraps nanobot's tool registry to emit events
before and after each tool execution:

```
nanobot executes tool
        │
        ▼
┌──────────────────┐       ┌─────────────┐
│  MonitoringServer │──────►│  GuardClaw   │
│  (ws://...:18790) │       │  Dashboard   │
└──────────────────┘       └─────────────┘
  tool.started               risk analysis
  tool.completed             event display
```

Every tool call (exec, read_file, write_file, web_fetch, message, etc.)
is captured and analyzed. GuardClaw normalizes nanobot events to the same
format as OpenClaw events, so the entire analysis pipeline works unchanged.

### Backend Selection

The `BACKEND` environment variable controls which agent(s) to monitor:

| Value | Behavior |
|-------|----------|
| `auto` (default) | Connects to both OpenClaw and nanobot; uses whichever is running |
| `openclaw` | Only connect to OpenClaw Gateway |
| `nanobot` | Only connect to nanobot monitoring server |

```bash
# Monitor only nanobot
BACKEND=nanobot npm start

# Monitor only OpenClaw
BACKEND=openclaw npm start

# Monitor both (default)
npm start
```

## Configuration

GuardClaw offers **three easy ways** to configure your setup:

### ⭐ Option 1: Web UI Settings (Recommended)

The easiest way - just click and configure:

1. Start GuardClaw: `guardclaw start`
2. Open http://localhost:3001
3. Click the ⚙️ **Settings** button (top right)
4. Click **🔍 Auto-Detect** to find your OpenClaw token
5. Click **Save & Reconnect** - done!

No terminal commands needed!

### Option 2: CLI Configuration

Quick setup from the command line:

```bash
# Auto-detect and save token from OpenClaw config
guardclaw config detect-token --save

# Or set token manually
guardclaw config set-token your_token_here

# View current config
guardclaw config show

# Start GuardClaw
guardclaw start
```

### Option 3: Environment Variables / .env File

For advanced users or CI/CD environments.

Create `.env` in your current directory:

```env
BACKEND=auto                           # auto | openclaw | nanobot
OPENCLAW_URL=ws://127.0.0.1:18789
OPENCLAW_TOKEN=your_token_here
NANOBOT_URL=ws://127.0.0.1:18790
SAFEGUARD_BACKEND=lmstudio              # lmstudio | ollama | anthropic
LMSTUDIO_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=openai/gpt-oss-20b
ANTHROPIC_API_KEY=your_claude_key_here
PORT=3001
```

Or export environment variables:

```bash
export OPENCLAW_TOKEN=your_token_here
export PORT=3001
```

### Option 4: Command-line Flags

Override config for a single run:

```bash
guardclaw start --port 3002 --openclaw-url ws://192.168.1.100:18789
```

**Priority order:** Command-line flags > Environment variables > .env file > Defaults

## Usage

### Basic Commands

```bash
# Start GuardClaw server
guardclaw start

# Stop GuardClaw server
guardclaw stop

# Show help
guardclaw help

# Show version
guardclaw version
```

### Configuration Management

GuardClaw now includes built-in config management for easy token setup:

```bash
# Auto-detect token from OpenClaw config
guardclaw config detect-token

# Auto-detect and save token
guardclaw config detect-token --save

# Set token manually
guardclaw config set-token <your-token-here>

# Show current token
guardclaw config get-token

# Show all config values
guardclaw config show
```

### Advanced Start Options

```bash
# Start on custom port
guardclaw start --port 3002

# Connect to remote OpenClaw Gateway
guardclaw start --openclaw-url ws://192.168.1.100:18789 --openclaw-token your_token

# Start without opening browser
guardclaw start --no-open
```

### Web UI Settings

Once running, open `http://localhost:3001` in your browser to access the
monitoring dashboard.

**New in v0.1.1:** Click the ⚙️ **Settings** button in the dashboard to:
- Configure OpenClaw Gateway token via web UI
- Auto-detect token from OpenClaw config (one-click)
- Save and automatically reconnect

This makes initial setup much easier - no need to manually edit `.env` files!

## CLI Command Reference

```bash
# Server Control
guardclaw start [options]         # Start GuardClaw server
guardclaw stop                     # Stop all GuardClaw processes

# Configuration
guardclaw config detect-token      # Find OpenClaw token (show only)
guardclaw config detect-token -s   # Find and save token to .env
guardclaw config set-token <token> # Set token manually
guardclaw config get-token         # Show current token (masked)
guardclaw config show              # Display all config values

# Utilities
guardclaw update                   # Update to latest version
guardclaw version                  # Show version
guardclaw help                     # Show help message

# Start Options
--port <port>                      # Custom port (default: 3001)
--openclaw-url <url>               # OpenClaw Gateway URL
--openclaw-token <token>           # OpenClaw token (overrides .env)
--no-open                          # Don't auto-open browser
```

## Features

### 1. Web UI Settings Panel (NEW!)

- **⚙️ One-Click Configuration**: Settings button in dashboard
- **🔍 Auto-Detect Token**: Automatically finds OpenClaw token
- **💾 Save & Reconnect**: Instant apply with automatic reconnection
- **🌓 Dark/Light Mode**: Beautiful theme toggle

### 2. CLI Configuration Tools (NEW!)

- **Quick Setup**: `guardclaw config detect-token --save`
- **View Config**: `guardclaw config show` displays all settings
- **Easy Management**: Set/get tokens from command line
- **Process Control**: `guardclaw stop` to cleanly shut down

### 3. Enhanced Trace Viewer

- Real-time visualization of all agent activities
- Detailed breakdown of tool calls (exec, Read, Write, API calls)
- Nested execution context (parent-child relationships)
- Timeline view with filtering

### 4. LLM-based Safeguard

Every command is analyzed by an LLM before execution:

- **Risk Score (0-10)**: Automatic risk assessment
- **Safety Categories**: File operations, network, system changes
- **Auto-block**: Prevents dangerous operations (rm -rf /, shutdown, etc.)
- **Smart approval**: User confirmation for medium-risk operations

### 5. Safety Levels

- 🟢 **Safe (0-3)**: Execute immediately
- 🟡 **Warning (4-7)**: Show warning, require acknowledgment
- 🔴 **Dangerous (8-10)**: Require explicit confirmation with details

## Architecture

```text
┌─────────────┐     ┌─────────────┐
│  OpenClaw   │     │   nanobot   │
│  Gateway    │     │   gateway   │
│  (:18789)   │     │  (:18790)   │
└──────┬──────┘     └──────┬──────┘
       │ WebSocket         │ WebSocket
       └────────┬──────────┘
                ▼
       ┌─────────────┐      ┌──────────────┐
       │  GuardClaw  │◄────►│ LM Studio    │
       │   Server    │      │ (Local LLM)  │
       └──────┬──────┘      └──────────────┘
              │ HTTP/SSE
              ▼
       ┌─────────────┐
       │  Web UI     │
       │  (React)    │
       └─────────────┘
```

## Safety Examples

### Safe command

```bash
ls -la ~/documents
```

Risk: 2/10 - Read-only directory listing ✅

### Warning command

```bash
rm important-file.txt
```

Risk: 6/10 - File deletion, requires confirmation ⚠️

### Dangerous command

```bash
rm -rf /
```

Risk: 10/10 - BLOCKED automatically 🚫

## Development

```bash
npm run dev       # Development mode with hot reload
npm run build     # Production build
npm test          # Run tests
```

## Tech Stack

- **Backend**: Node.js + Express + WebSocket
- **Frontend**: React + Vite + ReactFlow
- **AI Safety**: LM Studio (local LLM inference)
- **Real-time**: Server-Sent Events (SSE)

## License

GuardClaw is available under a **Dual License**:

- **FREE** for personal, educational, research, and open-source use
- **PAID commercial license** required for business/commercial use

See [LICENSE](LICENSE) file for full details.

**Commercial use?** Contact via [GitHub Issues](https://github.com/TobyGE/GuardClaw/issues)

## Credits

Inspired by [OpenClaw](https://github.com/openclaw/openclaw)
