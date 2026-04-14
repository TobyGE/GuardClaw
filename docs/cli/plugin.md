# Plugin Management

The `guardclaw plugin` command manages the GuardClaw interceptor plugin for OpenClaw. This plugin enables **pre-execution blocking** of tool calls through the OpenClaw gateway.

```bash
guardclaw plugin [install|uninstall|status]
```

## How it works

The interceptor plugin hooks into OpenClaw's `before_tool_call` event. When any agent connected through OpenClaw is about to execute a tool call:

1. The plugin intercepts the call
2. Sends it to GuardClaw's `/api/evaluate` endpoint
3. Based on the risk score, the call is allowed or blocked **before** execution

This is different from WebSocket monitoring, which only observes events after they happen. The plugin provides true pre-execution blocking.

## Install

```bash
guardclaw plugin install
```

This command:

1. Copies plugin files from the GuardClaw package to `~/.openclaw/plugins/guardclaw-interceptor/`
2. Registers the plugin in `~/.openclaw/openclaw.json`
3. Enables the plugin

```
📦 Installing GuardClaw interceptor plugin...

✅ Plugin files copied to: ~/.openclaw/plugins/guardclaw-interceptor
✅ Plugin enabled in OpenClaw config

⚠️  Restart OpenClaw Gateway: openclaw gateway restart
```

::: warning
After installing the plugin, you must restart the OpenClaw gateway for changes to take effect:
```bash
openclaw gateway restart
```
:::

## Uninstall

```bash
guardclaw plugin uninstall
```

Removes the plugin:

1. Removes plugin path from OpenClaw's `plugins.load.paths`
2. Deletes the plugin entry from `plugins.entries`
3. Deletes the plugin files from `~/.openclaw/plugins/guardclaw-interceptor/`

```
🗑️  Uninstalling...

✅ Plugin removed
⚠️  Restart OpenClaw Gateway: openclaw gateway restart
```

## Status

```bash
guardclaw plugin status
```

Check the current status of the interceptor plugin:

```
🔌 GuardClaw Interceptor Plugin

  Files    : ✅  ~/.openclaw/plugins/guardclaw-interceptor
  Registered: ✅
  Enabled  : ✅

  → Active. Restart gateway if recently changed.
```

Status checks three things:

| Check | Description |
|-------|-------------|
| Files | Plugin files exist at the install location |
| Registered | Plugin path is in OpenClaw's `plugins.load.paths` |
| Enabled | Plugin is enabled in `plugins.entries` |

### Possible states

| State | Message |
|-------|---------|
| Not installed | `→ Run: guardclaw plugin install` |
| Installed but disabled | `→ Enable via Dashboard (Blocking toggle)` |
| Active | `→ Active. Restart gateway if recently changed.` |

## Plugin location

| Path | Description |
|------|-------------|
| Source | `<guardclaw>/plugin/guardclaw-interceptor/` |
| Install target | `~/.openclaw/plugins/guardclaw-interceptor/` |
| Config | `~/.openclaw/openclaw.json` |

## Prerequisites

The plugin requires:

- OpenClaw installed and configured
- OpenClaw config at `~/.openclaw/openclaw.json`
- GuardClaw server running on the same machine (the plugin calls `http://127.0.0.1:3002/api/evaluate`)
