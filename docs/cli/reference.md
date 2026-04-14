# CLI Reference

## Core Commands

```bash
guardclaw start           # Start the server (opens dashboard in browser)
guardclaw start -f        # Start in foreground (Ctrl-C to stop)
guardclaw stop            # Stop the server
guardclaw status          # Show server and judge status
guardclaw setup           # Re-run the interactive setup wizard
guardclaw update          # Update to latest version (stops/restarts server)
```

## Configuration

```bash
guardclaw config llm              # Interactive LLM backend picker
guardclaw config mode             # Set approval mode
guardclaw config thresholds       # Set risk score thresholds
guardclaw config show             # Print current config
guardclaw config set KEY VALUE    # Set a single env var (applied immediately)

guardclaw config set-token <token>          # Set OpenClaw gateway token
guardclaw config detect-token --save        # Auto-detect and save token
```

### Commonly used `config set` keys

```bash
# Switch backend
guardclaw config set SAFEGUARD_BACKEND openrouter

# Set approval mode
guardclaw config set GUARDCLAW_APPROVAL_MODE prompt

# Adjust thresholds
guardclaw config set GUARDCLAW_AUTO_ALLOW_THRESHOLD 5
guardclaw config set GUARDCLAW_AUTO_BLOCK_THRESHOLD 8
```

All config changes apply to the running server immediately — no restart required.

## Plugin Management

```bash
guardclaw plugin install    # Install OpenClaw interceptor plugin
guardclaw plugin status     # Check plugin status
```

## Hook Installation (Claude Code)

```bash
node scripts/install-claude-code.js              # Install hooks
node scripts/install-claude-code.js --uninstall  # Remove hooks
```

## Manual Risk Check

```bash
guardclaw check "rm -rf /tmp/build"   # Score a command manually
```

## Options

| Flag | Command | Description |
|------|---------|-------------|
| `-f`, `--foreground` | `start` | Run in foreground instead of daemonizing |
| `--no-open` | `start` | Don't open browser on start |
| `--save` | `config detect-token` | Save detected token to config |
