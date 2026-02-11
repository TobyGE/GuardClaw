# GuardClaw 🛡️🐾

**AI Agent Safety Monitor with LLM-based Command Safeguard**

GuardClaw is an enhanced monitoring tool for Clawdbot agents that provides:
- 📊 **Detailed Trace Visualization** - See every tool call, command, and API request
- 🛡️ **LLM Safety Guard** - Analyze commands before execution to prevent dangerous operations
- ⏸️ **Interactive Approval** - Pause and request confirmation for high-risk operations
- 📝 **Complete Audit Log** - Full execution history with rollback capability

## Quick Start (TL;DR)

Runtime: Node ≥18

```bash
npm install -g guardclaw@latest

guardclaw start
```

Open browser: `http://localhost:3001`

That's it! GuardClaw will connect to your local Clawdbot Gateway at `ws://127.0.0.1:18789`.

## Installation

### Global Install (Recommended)

```bash
npm install -g guardclaw@latest
```

### From Source

```bash
git clone https://github.com/TobyGE/GuardClaw.git
cd GuardClaw
npm install
npm run build
npm link
```

## Configuration

GuardClaw works out of the box with sensible defaults. For custom configuration:

**Option 1: Environment variables**
```bash
export CLAWDBOT_URL=ws://127.0.0.1:18789
export CLAWDBOT_TOKEN=your_token_here
export ANTHROPIC_API_KEY=your_claude_key_here
export PORT=3001
```

**Option 2: .env file**
Create `.env` in your current directory:
```env
CLAWDBOT_URL=ws://127.0.0.1:18789
CLAWDBOT_TOKEN=your_token_here
ANTHROPIC_API_KEY=your_claude_key_here
PORT=3001
```

**Option 3: Command-line flags**
```bash
guardclaw start --port 3002 --clawdbot-url ws://192.168.1.100:18789
```

## Usage

```bash
# Start GuardClaw server
guardclaw start

# Start on custom port
guardclaw start --port 3002

# Connect to remote Clawdbot Gateway
guardclaw start --clawdbot-url ws://192.168.1.100:18789 --clawdbot-token your_token

# Show help
guardclaw help

# Show version
guardclaw version
```

Once running, open `http://localhost:3001` in your browser to access the monitoring dashboard.

## Features

### 1. Enhanced Trace Viewer
- Real-time visualization of all agent activities
- Detailed breakdown of tool calls (exec, Read, Write, API calls)
- Nested execution context (parent-child relationships)
- Timeline view with filtering

### 2. LLM-based Safeguard
Every command is analyzed by an LLM before execution:
- **Risk Score (0-10)**: Automatic risk assessment
- **Safety Categories**: File operations, network, system changes
- **Auto-block**: Prevents dangerous operations (rm -rf /, shutdown, etc.)
- **Smart approval**: User confirmation for medium-risk operations

### 3. Safety Levels
- 🟢 **Safe (0-3)**: Execute immediately
- 🟡 **Warning (4-7)**: Show warning, require acknowledgment
- 🔴 **Dangerous (8-10)**: Require explicit confirmation with details

## Architecture

```
┌─────────────┐
│  Clawdbot   │
│   Gateway   │
└──────┬──────┘
       │ WebSocket
       ▼
┌─────────────┐      ┌──────────────┐
│  GuardClaw  │◄────►│ Claude API   │
│   Server    │      │ (Safeguard)  │
└──────┬──────┘      └──────────────┘
       │ HTTP/WS
       ▼
┌─────────────┐
│  Web UI     │
│  (React)    │
└─────────────┘
```

## Safety Examples

**Safe command:**
```bash
ls -la ~/documents
```
Risk: 2/10 - Read-only directory listing ✅

**Warning command:**
```bash
rm important-file.txt
```
Risk: 6/10 - File deletion, requires confirmation ⚠️

**Dangerous command:**
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
- **AI Safety**: Claude API (Anthropic)
- **Real-time**: Server-Sent Events (SSE)

## License

MIT

## Credits

Inspired by [Crabwalk](https://github.com/luccast/crabwalk) by @luccasveg
Built for [Clawdbot](https://github.com/clawdbot/clawdbot)
