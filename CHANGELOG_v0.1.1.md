# GuardClaw v0.1.1 - Configuration Enhancement Update

## 🎉 New Features

### Web UI Configuration Panel

- **⚙️ Settings Button**: Easy access to configuration in the dashboard
- **🔍 Auto-Detect Token**: One-click detection of OpenClaw gateway token from `~/.openclaw/openclaw.json`
- **💾 Save & Reconnect**: Instantly save token and automatically reconnect to gateway
- **📝 Manual Input**: Also supports manual token entry with validation
- **🎨 Theme Integration**: Perfect dark/light mode support

### CLI Configuration Commands

New `guardclaw config` subcommands for easy setup:

```bash
# Auto-detect and display token
guardclaw config detect-token

# Auto-detect and save to .env
guardclaw config detect-token --save

# Set token manually
guardclaw config set-token <your-token>

# Show current token (masked for security)
guardclaw config get-token

# Display all configuration values
guardclaw config show
```

### Process Control

```bash
# Stop all GuardClaw processes cleanly
guardclaw stop
```

### Backend API Endpoints

- `POST /api/config/token` - Save OpenClaw token to .env and reconnect
- `GET /api/config/detect-token` - Auto-detect token from OpenClaw config
- Automatic reconnection after token update

## 🔧 Improvements

- **Easier Setup**: No need to manually edit `.env` files
- **Better UX**: Clear success/error messages in both CLI and Web UI
- **Auto-Discovery**: Automatically finds OpenClaw configuration
- **Security**: Token masking in CLI display (shows first 8 and last 4 chars)
- **Documentation**: Complete README update with all configuration methods

## 📚 Configuration Methods

Users now have **4 ways** to configure GuardClaw (in priority order):

1. **Web UI** (easiest for beginners)
2. **CLI commands** (fastest for terminal users)
3. **Environment variables** (best for automation)
4. **Command-line flags** (for one-off overrides)

## 🎯 Use Cases

### First-Time Setup (Beginner)
```bash
guardclaw start
# Click Settings → Auto-Detect → Save & Reconnect
```

### First-Time Setup (Advanced)
```bash
guardclaw config detect-token --save
guardclaw start
```

### Change Token
```bash
guardclaw config set-token <new-token>
guardclaw stop
guardclaw start
```

### Check Configuration
```bash
guardclaw config show
```

## 🐛 Bug Fixes

- Fixed device identity mismatch issues by providing easy token configuration
- Improved error messages for missing configuration
- Better handling of .env file creation and updates

## 📖 Documentation

- Completely updated README with new features
- Added CLI command reference section
- Clear examples for each configuration method
- Better Quick Start guide

## 🚀 Migration Guide

If you're upgrading from v0.1.0:

1. No breaking changes - existing `.env` files still work
2. New features are opt-in and additive
3. To use new settings UI: `npm run build` to rebuild client assets
4. Run `guardclaw config show` to verify your current config

## Next Steps

Try the new features:
```bash
# Update client assets
cd ~/clawd
npm run build

# Check your config
guardclaw config show

# Or use Web UI
guardclaw start
# Click ⚙️ Settings
```

---

**Release Date**: 2026-02-15  
**Contributors**: @TobyGE, Claude (OpenClaw Assistant)
