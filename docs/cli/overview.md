# CLI Overview

GuardClaw provides a full-featured command-line interface for managing the safety monitor, configuring LLM backends, connecting AI agents, and inspecting evaluation results.

## Installation

### Global install via npm

```bash
npm install -g guardclaw
```

After installation, the `guardclaw` command is available globally.

### From source

```bash
git clone https://github.com/TobyGE/GuardClaw.git
cd GuardClaw
npm install && npm install --prefix client && npm run build
npm link
```

### Verify installation

```bash
guardclaw version
# GuardClaw v0.1.6
```

## Command overview

| Command | Description |
|---------|-------------|
| [`start`](./server.md#start) | Start the GuardClaw server |
| [`stop`](./server.md#stop) | Stop the GuardClaw server |
| [`restart`](./server.md#restart) | Restart the server |
| [`status`](./server.md#status) | Server and agent connection overview |
| [`update`](./server.md#update) | Update GuardClaw to the latest version |
| [`setup`](./config.md#setup-wizard) | Run the interactive setup wizard |
| [`config`](./config.md) | Configuration management |
| [`hooks`](./hooks.md) | Manage agent hook integrations |
| [`plugin`](./plugin.md) | Manage the OpenClaw interceptor plugin |
| [`stats`](./monitoring.md#stats) | Evaluation statistics |
| [`history`](./monitoring.md#history) | Recent evaluations |
| [`check`](./monitoring.md#check) | Manually risk-score a command |
| [`blocking`](./monitoring.md#blocking) | Toggle blocking mode |
| [`model`](./monitoring.md#model) | LLM model management |
| [`approvals`](./monitoring.md#approvals) | Show pending approvals |
| [`memory`](./monitoring.md#memory) | Show learned patterns |
| [`brief`](./monitoring.md#brief) | Security memory sessions |
| `version` | Print version |
| `help` | Show help |

## Command aliases

Several commands have shorthand aliases:

| Alias | Command |
|-------|---------|
| `rs`, `r` | `restart` |
| `log`, `logs` | `history` |
| `models` | `model` |
| `block` | `blocking` |
| `analyze` | `check` |
| `pending` | `approvals` |
| `patterns` | `memory` |
| `buffer` | `brief` |
| `wizard` | `setup` |
| `upgrade` | `update` |
| `--version`, `-v` | `version` |
| `--help`, `-h` | `help` |

## Port configuration

By default, GuardClaw runs on port **3002**. You can change this with:

```bash
# Via start flag
guardclaw start --port 4000

# Via environment variable
guardclaw config set PORT 4000

# Via .env file
echo "PORT=4000" >> .env
```

The CLI reads the port from `GUARDCLAW_PORT`, then `PORT`, then defaults to `3002`.

## Hot-reload

All configuration changes made via the CLI are **applied immediately** to the running server — no restart required. This includes LLM backend changes, approval mode, thresholds, tokens, and more.

## Getting help

```bash
guardclaw help        # Full command reference
guardclaw --help      # Same as above
guardclaw -h          # Same as above
```
