# Supported Agents

GuardClaw works with 7 major coding agents out of the box.

| Agent | Integration | Pre-tool blocking | Approval flow |
|-------|------------|:-----------------:|:-------------:|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | HTTP hooks | ✅ | ✅ |
| [Codex CLI](https://github.com/openai/codex) | Command hooks | ✅ | ✅ |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | HTTP hooks | ✅ | ✅ |
| [OpenCode](https://opencode.ai) | HTTP hooks | ✅ | ✅ |
| [OpenClaw](https://github.com/openclaw/openclaw) | WebSocket plugin | ✅ | ✅ |
| [Cursor](https://cursor.com) | Shell hooks | ⚠️ shell only | ✅ |
| [GitHub Copilot CLI](https://github.com/github/copilot-sdk) | HTTP hooks | ✅ | ✅ |

> **Cursor note:** File operations (read/write/edit) are not intercepted — only shell commands.

## How Hooks Work

### HTTP hooks (Claude Code, Gemini CLI, OpenCode, GitHub Copilot CLI)

GuardClaw registers as an HTTP hook handler. Before each tool call, the agent POSTs to `localhost:3002/api/cc/pre-tool`. GuardClaw scores the call and returns `allow` or `block`.

Install:
```bash
node scripts/install-claude-code.js
```

Uninstall:
```bash
node scripts/install-claude-code.js --uninstall
```

### OpenClaw WebSocket plugin

The `guardclaw-interceptor` plugin hooks `before_tool_call` directly in the OpenClaw gateway. This enables pre-execution blocking of all tool types.

Install:
```bash
guardclaw plugin install
openclaw gateway restart
```

### Command hooks (Codex CLI, Cursor)

GuardClaw wraps shell command execution. Shell commands are intercepted; file read/write operations are not.

## Installing Hooks

The setup wizard (`guardclaw setup`) auto-detects installed agents and installs hooks with one confirm. You can also install manually per agent using the commands above.

After installing hooks, **restart the target agent** to activate them.
