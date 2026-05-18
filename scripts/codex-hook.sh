#!/bin/bash
# GuardClaw bridge for Codex CLI hooks
# Codex sends JSON on stdin; response JSON to stdout controls execution.
#   exit 0 = allow, exit 2 = block (PreToolUse / UserPromptSubmit only)
#
# Supported events: PreToolUse, PostToolUse, UserPromptSubmit, Stop, SessionStart

GUARDCLAW_PORT="${GUARDCLAW_PORT:-3002}"
GUARDCLAW_URL="http://127.0.0.1:${GUARDCLAW_PORT}"

# Logging: opt-in via GUARDCLAW_HOOK_LOG=1. Writes to ~/.guardclaw/logs/ with 0600 perms,
# rotates the file once it grows past ~1 MB. Never logs raw stdin payload.
INPUT=$(cat)
if [ "${GUARDCLAW_HOOK_LOG:-0}" = "1" ]; then
  LOG_DIR="${HOME}/.guardclaw/logs"
  mkdir -p "$LOG_DIR" 2>/dev/null
  GUARDCLAW_LOG="$LOG_DIR/codex-hook.log"
  if [ -f "$GUARDCLAW_LOG" ] && [ "$(wc -c <"$GUARDCLAW_LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then
    mv "$GUARDCLAW_LOG" "$GUARDCLAW_LOG.1" 2>/dev/null
  fi
  ( umask 077; echo "[$(date)] hook=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('hook_event_name','?'), d.get('tool_name','?'))" 2>/dev/null)" >> "$GUARDCLAW_LOG" )
fi

HOOK_EVENT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name','PreToolUse'))" 2>/dev/null)

# ── PostToolUse ───────────────────────────────────────────────────────────────
if [ "$HOOK_EVENT" = "PostToolUse" ]; then
  curl -s -X POST "${GUARDCLAW_URL}/api/hooks/codex/post-tool-use" \
    -H "Content-Type: application/json" \
    -d "$INPUT" > /dev/null 2>&1
  exit 0
fi

# ── UserPromptSubmit ──────────────────────────────────────────────────────────
if [ "$HOOK_EVENT" = "UserPromptSubmit" ]; then
  curl -s -X POST "${GUARDCLAW_URL}/api/hooks/codex/user-prompt" \
    -H "Content-Type: application/json" \
    -d "$INPUT" > /dev/null 2>&1
  exit 0
fi

# ── Stop ──────────────────────────────────────────────────────────────────────
if [ "$HOOK_EVENT" = "Stop" ]; then
  curl -s -X POST "${GUARDCLAW_URL}/api/hooks/codex/stop" \
    -H "Content-Type: application/json" \
    -d "$INPUT" > /dev/null 2>&1
  exit 0
fi

# ── SessionStart ─────────────────────────────────────────────────────────────
if [ "$HOOK_EVENT" = "SessionStart" ]; then
  curl -s -X POST "${GUARDCLAW_URL}/api/hooks/codex/session-start" \
    -H "Content-Type: application/json" \
    -d "$INPUT" > /dev/null 2>&1
  exit 0
fi

# ── ContextCompaction ────────────────────────────────────────────────────────
if [ "$HOOK_EVENT" = "ContextCompaction" ]; then
  curl -s -X POST "${GUARDCLAW_URL}/api/hooks/codex/context-compaction" \
    -H "Content-Type: application/json" \
    -d "$INPUT" > /dev/null 2>&1
  exit 0
fi

# ── PreToolUse ────────────────────────────────────────────────────────────────
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${GUARDCLAW_URL}/api/hooks/codex/pre-tool-use" \
  -H "Content-Type: application/json" \
  -d "$INPUT" \
  --connect-timeout 3 \
  --max-time 310 2>/dev/null)

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

# GuardClaw unreachable — fail-open (output nothing = allow)
if [ -z "$HTTP_CODE" ] || [ "$HTTP_CODE" = "000" ]; then
  exit 0
fi

echo "$BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except:
    sys.exit(0)

decision = d.get('decision', 'allow')
reason   = d.get('reason', '')
message  = d.get('message', '')

if decision == 'block':
    out = {
        'hookSpecificOutput': {
            'hookEventName': 'PreToolUse',
            'permissionDecision': 'deny',
            'permissionDecisionReason': reason or 'Blocked by GuardClaw',
        }
    }
    print(json.dumps(out))
    sys.exit(2)

# allow: show score/reason as systemMessage only (no permissionDecision)
if message:
    print(json.dumps({'systemMessage': message}))
" 2>/dev/null
