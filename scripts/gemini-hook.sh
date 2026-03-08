#!/bin/bash
# GuardClaw bridge for Gemini CLI hooks (BeforeTool / AfterTool)
# Gemini CLI sends: { session_id, tool_name, tool_input, hook_event_name, cwd, ... }
# Response: JSON to stdout only. systemMessage is displayed to user in terminal.
#   exit 0 = allow, exit 2 = block

GUARDCLAW_PORT="${GUARDCLAW_PORT:-3002}"
GUARDCLAW_URL="http://127.0.0.1:${GUARDCLAW_PORT}"

# Read all of stdin
INPUT=$(cat)

# Determine hook type from JSON hook_event_name field
HOOK_EVENT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name','BeforeTool'))" 2>/dev/null)

if [ "$HOOK_EVENT" = "AfterTool" ]; then
  curl -s -X POST "${GUARDCLAW_URL}/api/hooks/gemini/post-tool-use" \
    -H "Content-Type: application/json" \
    -d "$INPUT" > /dev/null 2>&1
  echo '{"decision":"allow"}'
  exit 0
fi

# BeforeTool: evaluate and potentially block
# Long timeout: server holds connection open while waiting for user approval
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${GUARDCLAW_URL}/api/hooks/gemini/pre-tool-use" \
  -H "Content-Type: application/json" \
  -d "$INPUT" \
  --connect-timeout 3 \
  --max-time 310 2>/dev/null)

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

# If GuardClaw is unreachable, allow (fail-open)
if [ -z "$HTTP_CODE" ] || [ "$HTTP_CODE" = "000" ]; then
  echo '{"decision":"allow","systemMessage":"⛨ GuardClaw: server unreachable, fail-open"}'
  exit 0
fi

# Parse response with python3 and output final JSON to stdout
echo "$BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except:
    print(json.dumps({'decision':'allow'}))
    sys.exit(0)

decision = d.get('decision', 'allow')
reason = d.get('reason', '')
message = d.get('message', '')

if decision == 'block':
    out = {'decision': 'block', 'reason': reason}
    if reason:
        out['systemMessage'] = '⛨ GuardClaw BLOCK: ' + reason
    print(json.dumps(out))
    sys.exit(2)

# Allow — show GuardClaw status via systemMessage
out = {'decision': 'allow'}
if message:
    out['systemMessage'] = message
print(json.dumps(out))
" 2>/dev/null

# If python3 failed, fallback
if [ $? -ne 0 ] && [ $? -ne 2 ]; then
  echo '{"decision":"allow"}'
fi
