#!/usr/bin/env bash
# patch-openclaw.sh — Auto-patch OpenClaw to broadcast tool events to GuardClaw
#
# What this does:
#   OpenClaw normally only sends tool events to clients that registered for them
#   (via agent.send). This patch adds one extra broadcast() call so that passive
#   monitoring tools like GuardClaw can receive ALL tool events without starting
#   agent runs.
#
# Usage: bash scripts/patch-openclaw.sh

set -e

OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/openclaw}"
TARGET="$OPENCLAW_DIR/src/gateway/server-chat.ts"

echo "🛡️  GuardClaw — OpenClaw patch"
echo ""

# ── Sanity checks ─────────────────────────────────────────────────────────────
if [ ! -d "$OPENCLAW_DIR" ]; then
  echo "❌  OpenClaw not found at $OPENCLAW_DIR"
  echo "    Set OPENCLAW_DIR if your installation is elsewhere:"
  echo "    OPENCLAW_DIR=/path/to/openclaw bash scripts/patch-openclaw.sh"
  exit 1
fi

if [ ! -f "$TARGET" ]; then
  echo "❌  server-chat.ts not found at $TARGET"
  echo "    Is this a supported version of OpenClaw?"
  exit 1
fi

# ── Already patched? ──────────────────────────────────────────────────────────
if grep -q 'broadcast("agent", toolPayload); // guardclaw' "$TARGET"; then
  echo "✅  Patch already applied — nothing to do."
  echo ""
  echo "If GuardClaw still isn't receiving tool events, try:"
  echo "  openclaw gateway restart"
  exit 0
fi

# ── Apply patch ───────────────────────────────────────────────────────────────
# Find the line with broadcastToConnIds inside the isToolEvent block and
# insert our broadcast() call right after it.
if ! grep -q 'broadcastToConnIds("agent", toolPayload, recipients)' "$TARGET"; then
  echo "❌  Could not find insertion point in server-chat.ts"
  echo "    Your OpenClaw version may differ. Please apply manually:"
  echo ""
  echo '    Inside the `if (isToolEvent)` block, after the broadcastToConnIds line, add:'
  echo '    broadcast("agent", toolPayload); // guardclaw'
  exit 1
fi

# Backup original
cp "$TARGET" "$TARGET.bak"
echo "📄  Backed up original to server-chat.ts.bak"

# Use node for reliable multi-line substitution
node - "$TARGET" <<'EOF'
const fs = require('fs');
const file = process.argv[1];
let src = fs.readFileSync(file, 'utf8');

const needle = 'broadcastToConnIds("agent", toolPayload, recipients);';
const insertion = '      broadcast("agent", toolPayload); // guardclaw';

if (src.includes(insertion)) {
  console.log('Already patched.');
  process.exit(0);
}

// Insert the new line right after the needle
src = src.replace(needle, needle + '\n' + insertion);
fs.writeFileSync(file, src);
console.log('Patch applied.');
EOF

echo "✅  Patch applied to server-chat.ts"
echo ""

# ── Rebuild ───────────────────────────────────────────────────────────────────
echo "🔨  Building OpenClaw (this takes ~10 seconds)…"
cd "$OPENCLAW_DIR"
npm run build 2>&1 | tail -5

echo ""
echo "🔄  Restarting OpenClaw gateway…"
openclaw gateway restart 2>/dev/null || {
  echo "    (Could not auto-restart — please run: openclaw gateway restart)"
}

echo ""
echo "🎉  Done! GuardClaw will now receive all tool events."
echo "    Start GuardClaw: cd ~/guardclaw && node server/index.js"
