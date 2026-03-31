#!/bin/bash
# GuardClaw bridge for Codex CLI hooks
# Codex sends JSON on stdin; response JSON to stdout controls execution.
#   exit 0 = allow, exit 2 = block (PreToolUse / UserPromptSubmit only)
#
# Supported events: PreToolUse, PostToolUse, UserPromptSubmit, Stop, SessionStart

GUARDCLAW_PORT="${GUARDCLAW_PORT:-3002}"
GUARDCLAW_URL="http://127.0.0.1:${GUARDCLAW_PORT}"
GUARDCLAW_LOG="/tmp/guardclaw-codex-hook.log"

INPUT=$(cat)
echo "[$(date)] invoked hook_event=$(echo "$INPUT" | python3 -c "import sys,json,os; d=json.load(sys.stdin); print(d.get('hook_event_name','?'), d.get('tool_name','?'))" 2>/dev/null)" >> "$GUARDCLAW_LOG"

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

# GuardClaw unreachable — fail-open
if [ -z "$HTTP_CODE" ] || [ "$HTTP_CODE" = "000" ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"},"systemMessage":"⛨ GuardClaw: server unreachable, fail-open"}'
  exit 0
fi

echo "$BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except:
    print(json.dumps({'hookSpecificOutput':{'hookEventName':'PreToolUse','permissionDecision':'allow'}}))
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

out = {'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'permissionDecision': 'allow'}}
if message:
    out['systemMessage'] = message
print(json.dumps(out))
" 2>/dev/null

if [ $? -ne 0 ] && [ $? -ne 2 ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
fi
