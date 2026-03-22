#!/bin/bash
# GuardClaw hook for Claude Code PreToolUse (command hook)
# Uses a shell command hook so that high-risk actions prompt the user directly
# in the terminal — works correctly even with --dangerously-skip-permissions,
# where Claude Code's own 'ask' dialog is bypassed/blocked.

GUARDCLAW_PORT="${GUARDCLAW_PORT:-3002}"
GUARDCLAW_URL="http://127.0.0.1:${GUARDCLAW_PORT}"

INPUT=$(cat)

# Send to GuardClaw for evaluation (long timeout for LLM eval + user approval)
RESPONSE=$(curl -s -X POST "${GUARDCLAW_URL}/api/hooks/pre-tool-use" \
  -H "Content-Type: application/json" \
  -d "$INPUT" \
  --connect-timeout 3 \
  --max-time 60 2>/dev/null)

# If server is unreachable, fail-open
if [ -z "$RESPONSE" ]; then
  exit 0
fi

# Parse permissionDecision from hookSpecificOutput
DECISION=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    h = d.get('hookSpecificOutput', {})
    print(h.get('permissionDecision', 'allow'))
except:
    print('allow')
" 2>/dev/null || echo "allow")

REASON=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    h = d.get('hookSpecificOutput', {})
    r = h.get('permissionDecisionReason', '') or d.get('systemMessage', '')
    print(r)
except:
    print('')
" 2>/dev/null || echo "")

if [ "$DECISION" = "allow" ]; then
  exit 0
fi

# High risk — display details and ask user directly in the terminal.
# Reading from /dev/tty works even when stdin is piped (--dangerously-skip-permissions).
TOOL_NAME=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    print(json.load(sys.stdin).get('tool_name', 'unknown'))
except:
    print('unknown')
" 2>/dev/null || echo "unknown")

TOOL_INPUT=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    inp = json.load(sys.stdin).get('tool_input', {})
    for key in ['command', 'prompt', 'description', 'file_path', 'url', 'query', 'pattern']:
        if key in inp:
            print(str(inp[key])[:200])
            sys.exit(0)
    print(str(inp)[:200])
except:
    print('')
" 2>/dev/null || echo "")

printf '\n' >&2
printf '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' >&2
printf '⛨  GuardClaw: HIGH RISK ACTION DETECTED\n' >&2
printf '   Tool:   %s\n' "$TOOL_NAME" >&2
[ -n "$TOOL_INPUT" ] && printf '   Input:  %s\n' "$TOOL_INPUT" >&2
[ -n "$REASON" ]     && printf '   Reason: %s\n' "$REASON" >&2
printf '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' >&2
printf '\n' >&2

read -r -p "Allow this action? [y/N] " ans </dev/tty 2>/dev/tty

if [[ "$ans" =~ ^[Yy]$ ]]; then
  printf '✅  GuardClaw: action approved\n\n' >&2
  exit 0
else
  printf '🚫  GuardClaw: action blocked\n\n' >&2
  exit 2
fi
