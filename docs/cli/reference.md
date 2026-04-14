# CLI Quick Reference

A compact reference for all GuardClaw CLI commands. For detailed documentation, see the individual pages linked below.

## Server

```bash
guardclaw start [-f] [--port N] [--no-open]    # Start server
guardclaw stop                                   # Stop server
guardclaw restart                                # Restart (aliases: rs, r)
guardclaw status                                 # Server overview
guardclaw update                                 # Update to latest version
```

[Full server documentation →](./server)

## Configuration

```bash
guardclaw config                    # Interactive menu
guardclaw config show               # Show all settings
guardclaw config set <KEY> <VALUE>  # Set any variable (hot-reload)
guardclaw config llm                # Change LLM backend
guardclaw config mode               # Change approval mode
guardclaw config thresholds         # Change risk thresholds
guardclaw config eval               # Change evaluation mode
guardclaw config agents             # Manage agent connections
guardclaw config set-token <tok>    # Set OpenClaw token
guardclaw config detect-token       # Auto-detect OpenClaw token
guardclaw config get-token          # Show current token
guardclaw setup                     # Run setup wizard
```

[Full config documentation →](./config)

## Monitoring

```bash
guardclaw stats                     # Evaluation statistics
guardclaw history [n]               # Recent evaluations (default: 20)
guardclaw check <command>           # Manually risk-score a command
guardclaw blocking [on|off]         # Toggle blocking mode
guardclaw model [load|unload]       # LLM model management
guardclaw approvals                 # Show pending approvals
guardclaw memory                    # Show learned patterns
guardclaw brief                     # Security memory sessions
```

[Full monitoring documentation →](./monitoring)

## Hooks

```bash
guardclaw hooks                              # Show hook status
guardclaw hooks install [claude-code|codex|all]
guardclaw hooks uninstall [claude-code|codex|all]
```

[Full hooks documentation →](./hooks)

## Plugin

```bash
guardclaw plugin install      # Install OpenClaw interceptor
guardclaw plugin uninstall    # Remove plugin
guardclaw plugin status       # Check status
```

[Full plugin documentation →](./plugin)

## Environment Variables

All configuration is stored in `.env`. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SAFEGUARD_BACKEND` | `lmstudio` | LLM backend |
| `GUARDCLAW_APPROVAL_MODE` | `auto` | Approval mode |
| `GUARDCLAW_AUTO_ALLOW_THRESHOLD` | `6` | Auto-allow threshold |
| `GUARDCLAW_AUTO_BLOCK_THRESHOLD` | `9` | Auto-block threshold |
| `PORT` | `3002` | Server port |

[Full environment reference →](./environment)
