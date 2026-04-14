# Server Management

Commands for starting, stopping, and updating the GuardClaw server.

## start

Start the GuardClaw server and open the dashboard in your browser.

```bash
guardclaw start [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-f`, `--foreground` | Run in foreground (Ctrl-C to stop) | Daemon mode |
| `--port <port>` | Server port | `3002` |
| `--no-open` | Don't open browser on start | Opens browser |
| `--no-onboarding` | Skip first-run setup wizard (useful for CI/scripts) | Runs wizard |
| `--openclaw-url <url>` | OpenClaw gateway URL | From `.env` |
| `--openclaw-token <token>` | OpenClaw gateway token | From `.env` |
| `--anthropic-key <key>` | Anthropic API key | From `.env` |

Legacy aliases `--clawdbot-url` and `--clawdbot-token` also work for `--openclaw-url` and `--openclaw-token`.

### Daemon mode (default)

By default, `guardclaw start` runs the server as a **background daemon**. The process detaches from the terminal and continues running after you close the shell.

```bash
guardclaw start
# ✅ GuardClaw running in background (PID 12345)
# 📜 Logs: .guardclaw/server.log
# 🛑 Stop with: guardclaw stop
```

- Server logs are written to `.guardclaw/server.log` in the current directory.
- The PID file is not written; the `stop` command finds the process via process table and port inspection.

### Foreground mode

Use `-f` or `--foreground` to run in the current terminal. The server's stdout/stderr is printed directly. Press Ctrl-C to stop.

```bash
guardclaw start -f
```

This is useful for development, debugging, or when running inside a container.

### First-run onboarding

On first launch (when no `.env` file exists), the CLI runs a 4-step interactive setup wizard:

1. **Evaluation mode** — local-only, mixed, or cloud-only
2. **LLM backend** — LM Studio, Ollama, Built-in, or Fallback (+ cloud provider for mixed/cloud)
3. **Response mode** — auto or monitor-only
4. **Agent connections** — auto-detects and connects installed agents

Skip this with `--no-onboarding` or by running `guardclaw setup` manually later.

### Working directory

The server runs in **your current working directory**, not the npm install directory. This means:

- `.env` is read from your current directory
- `.guardclaw/` data directory (events.db, memory.db) is created in your current directory
- Each project can have its own GuardClaw configuration and event history

### Examples

```bash
# Start with all defaults
guardclaw start

# Start on custom port, no browser
guardclaw start --port 4000 --no-open

# Start in foreground for debugging
guardclaw start -f --port 3002

# Start with OpenClaw token inline
guardclaw start --openclaw-token eyJ...

# Start in CI without interactive wizard
guardclaw start --no-onboarding --no-open
```

## stop

Stop the running GuardClaw server.

```bash
guardclaw stop
```

The command finds GuardClaw processes in two ways:

1. **Process table scan** — searches `ps ax` for processes running `server/index.js` with "guardclaw" in the command, or whose working directory is the GuardClaw install directory.
2. **Port listener scan** — finds any process listening on the GuardClaw port (default 3002) that is running `server/index.js`.

All matched processes are terminated with `SIGKILL`.

```bash
guardclaw stop
# 🛑 Stopping GuardClaw...
# ✅ Stopped PID 12345
# ✅ Stopped 1 process(es)
```

If no GuardClaw process is found:

```
ℹ️  GuardClaw is not running.
```

## restart

Stop the server and start it again. Accepts all the same options as [`start`](#start).

```bash
guardclaw restart [options]
```

Aliases: `rs`, `r`

```bash
# Quick restart
guardclaw rs

# Restart on a different port
guardclaw restart --port 4000
```

The command waits 300ms between stop and start to allow the OS to release sockets and PIDs.

## status

Show a comprehensive overview of the running server state.

```bash
guardclaw status
```

Output includes:

- **Running** — PID of the server process
- **Blocking** — whether pre-execution blocking is enabled
- **Fail-closed** — whether the server blocks tool calls when the LLM is unavailable
- **LLM** — active backend and loaded model
- **Agent Connections** — each connected agent with type (hook/ws) and event count
- **Events** — total, safe, warning, and blocked counts
- **Cache** — hits, misses, and AI calls

Example output:

```
⛨  GuardClaw Status

  Running:     ✅ Yes  (PID 12345)
  Blocking:    🟢 OFF (monitor only)
  Fail-closed: No
  LLM:         lmstudio (qwen/qwen3-4b-2507)

  Agent Connections
  ✅ Claude Code       [hook]  42 events
  ⚪ Codex             [hook]
  ✅ OpenClaw          [ws]    18 events

  Events: 60 total  🟢 45 safe  🟡 12 warn  🔴 3 blocked
  Cache:  38 hits / 22 misses / 22 AI calls
```

::: tip
`guardclaw status` requires the server to be running. If the server is offline, it will print an error message and exit.
:::

## update

Update GuardClaw to the latest version from npm.

```bash
guardclaw update
```

Alias: `upgrade`

The command:

1. Checks the current version against the latest on npm
2. If already up to date, prints a message and exits
3. Stops the running server (if any)
4. Runs `npm install -g guardclaw@latest`
5. Restarts the server if it was running before the update

```bash
guardclaw update
# 🔄 Updating GuardClaw...  0.1.5 → 0.1.6
# 🛑 Stopping server before update...
# ✅ Updated successfully
# 🔄 Restarting server...
```

## version

Print the installed version.

```bash
guardclaw version
guardclaw --version
guardclaw -v
```
