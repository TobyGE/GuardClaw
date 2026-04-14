# Hook Integrations

The `guardclaw hooks` command manages hook installations for AI coding agents. Hooks intercept tool calls from agents and send them to GuardClaw for risk evaluation.

```bash
guardclaw hooks [install|uninstall] [agent]
```

## Show status

```bash
guardclaw hooks
```

Shows the installation status of all supported agents:

```
⛨  Hook Integrations

  ✅ Claude Code    installed
  ⚪ Codex          not installed
  —  Gemini CLI     not detected

  guardclaw hooks install [claude-code|codex|all]
  guardclaw hooks uninstall [claude-code|codex|all]
```

Status icons:

| Icon | Meaning |
|------|---------|
| ✅ | Hooks installed and active |
| ⚪ | Agent detected but hooks not installed |
| — | Agent not detected on this system |

## Install hooks

```bash
guardclaw hooks install [agent]
```

| Argument | Description |
|----------|-------------|
| `claude-code` | Install hooks for Claude Code only |
| `codex` | Install hooks for Codex only |
| `all` | Install hooks for all detected agents |
| *(none)* | Same as `all` |

### Claude Code hooks

Installs HTTP hook endpoints into `~/.claude/settings.json`:

- **Pre-tool hook** — `POST /api/cc/pre-tool` — evaluates the tool call before execution
- **Post-tool hook** — `POST /api/cc/post-tool` — records the result after execution
- **Prompt hook** — `POST /api/cc/prompt` — injects security context into prompts
- **Stop hook** — `POST /api/cc/stop` — cleanup on session end

```bash
guardclaw hooks install claude-code
# ✅ Claude Code hooks installed  (~/.claude/settings.json)
```

### Codex hooks

Installs hook configuration into the Codex hooks directory at `~/.codex/hooks/`.

```bash
guardclaw hooks install codex
# ✅ Codex hooks installed
```

### Install all

```bash
guardclaw hooks install all
# ✅ Claude Code hooks installed
# ✅ Codex hooks installed
```

Only installs hooks for agents detected on your system.

## Uninstall hooks

```bash
guardclaw hooks uninstall [agent]
```

| Argument | Description |
|----------|-------------|
| `claude-code` | Remove Claude Code hooks |
| `codex` | Remove Codex hooks |
| `all` | Remove all hooks |
| *(none)* | Same as `all` |

```bash
guardclaw hooks uninstall claude-code
# ✅ Claude Code hooks removed
```

## Supported agents

### Hook-based agents

These agents support GuardClaw hooks for **pre-execution blocking** — GuardClaw can evaluate and block tool calls before they run.

| Agent | Config path | Detection |
|-------|-------------|-----------|
| Claude Code | `~/.claude/settings.json` | `~/.claude` directory |
| Codex | `~/.codex/hooks/` | `~/.codex` directory |
| Gemini CLI | `~/.gemini/` | `~/.gemini` directory |
| Cursor | `~/.cursor/` | `~/.cursor` directory |
| Copilot CLI | `~/.claude/settings.json` (shared) | `~/.copilot` directory |

::: info
Copilot CLI shares the same hook configuration as Claude Code, since both use the same hook format.
:::

### WebSocket-based agents

These agents connect via WebSocket gateway for **monitoring** — GuardClaw receives tool call events in real time.

| Agent | Gateway port | Config path |
|-------|-------------|-------------|
| OpenClaw | `18789` | `~/.openclaw/openclaw.json` |
| Qclaw | `28789` | `~/.qclaw/openclaw.json` |

WebSocket agents are connected by saving their gateway token:

```bash
# Auto-detect and save
guardclaw config detect-token --save

# Or set manually
guardclaw config set-token <token>
```

## How hooks work

When a hook-based agent (like Claude Code) is about to execute a tool call:

1. The agent sends the tool call details to GuardClaw's HTTP endpoint
2. GuardClaw runs the tool call through its risk scoring pipeline
3. Based on the risk score and current thresholds:
   - **SAFE** (score 1–3) → auto-approved, agent proceeds
   - **WARNING** (score 4–7) → approved with a warning injected into the agent's context
   - **HIGH RISK** (score 8–10) → blocked, agent is told to use an alternative approach
4. After execution, the post-tool hook records the result for chain analysis
