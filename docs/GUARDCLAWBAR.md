# GuardClawBar — macOS Menu Bar App

<p align="center">
  <img src="screenshots/guardclawbar-popover.png" width="360" alt="GuardClawBar screenshot">
</p>

A native macOS menu bar app for GuardClaw. Monitor your AI agents, approve or deny risky tool calls, and get desktop notifications — all without opening a browser.

## Features

- **Live status** in your menu bar — green/red dot shows connection state
- **Days protected** counter
- **Approve / Deny** pending tool calls directly from the popover
- **Desktop notifications** when a risky command needs your attention
- **Per-backend tabs** — switch between Claude Code and OpenClaw events
- **Native macOS** — SwiftUI, lightweight (~3 MB), no Electron

## Requirements

- macOS 14+ (Sonoma or later)
- Apple Silicon or Intel Mac
- GuardClaw server running (`guardclaw start` or `npm start`)

## Install

### Option 1: Download DMG (recommended)

1. Go to [Releases](https://github.com/TobyGE/GuardClaw/releases)
2. Download the latest `GuardClawBar-vX.X.X.dmg`
3. Open the DMG, drag **GuardClawBar** into **Applications**
4. Launch GuardClawBar from Applications

> **First launch:** macOS may block unsigned apps. Right-click → **Open** → click **Open** in the dialog. If it's still blocked:
> ```bash
> xattr -cr /Applications/GuardClawBar.app
> ```

### Option 2: Build from source

```bash
cd GuardClaw/GuardClawBar
swift build
# Run directly:
.build/arm64-apple-macosx/debug/GuardClawBar
```

For a universal release build (arm64 + x86_64):

```bash
swift build -c release --arch arm64 --arch x86_64
```

## Configuration

Click the **gear icon** in the popover footer to open settings:

| Setting | Default | Description |
|---------|---------|-------------|
| Server URL | `http://localhost:3002` | GuardClaw server address |
| Poll interval | 3 seconds | How often to fetch status updates |
| Notifications | On | Desktop alerts for pending approvals |
| Launch at login | Off | Start GuardClawBar when you log in |

## Usage

1. **Start GuardClaw** — `guardclaw start` or `npm start` in the GuardClaw directory
2. **Click the menu bar icon** — shows the popover with live status
3. **Approve/Deny** — when a tool call needs your input, a notification pops up and the icon shows a badge count
4. **Switch tabs** — view Claude Code or OpenClaw events separately

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Icon doesn't appear | Make sure GuardClawBar is running — check Activity Monitor |
| "Disconnected" | Is GuardClaw server running? Check `http://localhost:3002` in a browser |
| No notifications | Open System Settings → Notifications → GuardClawBar → Allow |
| macOS blocks the app | Run `xattr -cr /Applications/GuardClawBar.app` |

## Uninstall

1. Quit GuardClawBar (click icon → Quit)
2. Delete from Applications: `rm -rf /Applications/GuardClawBar.app`
