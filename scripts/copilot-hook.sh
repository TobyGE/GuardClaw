#!/bin/bash
# GuardClaw hook script for GitHub Copilot CLI
# Receives JSON on stdin, forwards to GuardClaw, outputs Copilot-format response

GUARDCLAW_PORT="${GUARDCLAW_PORT:-3002}"
GUARDCLAW_URL="http://127.0.0.1:${GUARDCLAW_PORT}"
DEBUG_LOG="/tmp/guardclaw-copilot-hook.log"

# Read JSON from stdin
INPUT=$(cat)

# Debug: log raw input
echo "$(date '+%H:%M:%S') INPUT: $INPUT" >> "$DEBUG_LOG"

# Determine event type — try hook_event_name first, then hookEventName
EVENT=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('hook_event_name', d.get('hookEventName', d.get('event', ''))))
" 2>/dev/null)

echo "$(date '+%H:%M:%S') EVENT=$EVENT" >> "$DEBUG_LOG"

if [ "$EVENT" = "PreToolUse" ] || [ "$EVENT" = "pre_tool_use" ]; then
  # Transform Copilot format → GuardClaw format
  GC_BODY=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
out = {
    'session_id': d.get('sessionId', d.get('session_id', '')),
    'cwd': d.get('cwd', ''),
    'hook_event_name': 'PreToolUse',
    'permission_mode': d.get('permissionMode', d.get('permission_mode', 'default')),
    'tool_name': d.get('toolName', d.get('tool_name', '')),
    'tool_input': d.get('toolArgs', d.get('tool_input', d.get('toolInput', {}))),
}
json.dump(out, sys.stdout)
" 2>/dev/null)

  echo "$(date '+%H:%M:%S') GC_BODY: $GC_BODY" >> "$DEBUG_LOG"

  # Call GuardClaw
  RESPONSE=$(curl -s -m 30 -X POST \
    -H 'Content-Type: application/json' \
    -d "$GC_BODY" \
    "${GUARDCLAW_URL}/api/hooks/pre-tool-use" 2>/dev/null)

  echo "$(date '+%H:%M:%S') RESPONSE: $RESPONSE" >> "$DEBUG_LOG"

  if [ -z "$RESPONSE" ]; then
    exit 0
  fi

  # Transform GuardClaw response → Copilot format
  echo "$RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    hso = d.get('hookSpecificOutput', {})
    decision = hso.get('permissionDecision', 'allow')
    reason = hso.get('permissionDecisionReason', '')
    if decision == 'block':
        decision = 'deny'
    out = {}
    if decision != 'allow':
        out['permissionDecision'] = decision
        out['permissionDecisionReason'] = reason
    if d.get('systemMessage'):
        out['additionalContext'] = d['systemMessage']
    if out:
        json.dump(out, sys.stdout)
except:
    pass
" 2>/dev/null

elif [ "$EVENT" = "PostToolUse" ] || [ "$EVENT" = "post_tool_use" ]; then
  GC_BODY=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
out = {
    'session_id': d.get('sessionId', d.get('session_id', '')),
    'cwd': d.get('cwd', ''),
    'hook_event_name': 'PostToolUse',
    'tool_name': d.get('toolName', d.get('tool_name', '')),
    'tool_input': d.get('toolArgs', d.get('tool_input', d.get('toolInput', {}))),
    'tool_output': d.get('toolResult', d.get('toolOutput', d.get('tool_output', ''))),
}
json.dump(out, sys.stdout)
" 2>/dev/null)

  curl -s -m 10 -X POST \
    -H 'Content-Type: application/json' \
    -d "$GC_BODY" \
    "${GUARDCLAW_URL}/api/hooks/post-tool-use" >/dev/null 2>&1

else
  # Unknown event or no event field — log everything for debugging
  echo "$(date '+%H:%M:%S') UNKNOWN EVENT, dumping all keys:" >> "$DEBUG_LOG"
  echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print('Keys:', list(d.keys()))
    for k, v in d.items():
        print(f'  {k}: {repr(v)[:200]}')
except Exception as e:
    print(f'Parse error: {e}')
" >> "$DEBUG_LOG" 2>&1
fi
