#!/bin/bash
# GuardClaw bridge for Cursor IDE hooks
# Cursor hook events: beforeShellExecution, afterShellExecution, afterFileEdit, beforeMCPExecution
# Cursor sends JSON via stdin with fields: command, cwd, hook_event_name, workspace_roots, etc.
# Response: {"permission": "allow"|"deny", "userMessage": "...", "agentMessage": "..."}
#   exit 0 = allow, exit 2 = block

GUARDCLAW_PORT="${GUARDCLAW_PORT:-3002}"
GUARDCLAW_URL="http://127.0.0.1:${GUARDCLAW_PORT}"

# Read all of stdin
INPUT=$(cat)

# Log hook input for debugging
echo "$(date '+%H:%M:%S') $INPUT" >> /tmp/guardclaw-cursor-hook.log 2>/dev/null &

# Determine hook type from JSON hook_event_name field
HOOK_EVENT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name',''))" 2>/dev/null)

# Post-execution hooks: fire-and-forget, always allow
if [ "$HOOK_EVENT" = "afterShellExecution" ] || [ "$HOOK_EVENT" = "afterFileEdit" ]; then
  curl -s -X POST "${GUARDCLAW_URL}/api/hooks/cursor/post-tool-use" \
    -H "Content-Type: application/json" \
    -d "$INPUT" > /dev/null 2>&1
  echo '{"permission":"allow"}'
  exit 0
fi

# Pre-execution hooks: evaluate and potentially block
# Normalize Cursor's format to GuardClaw's expected format
NORMALIZED=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
hook_event = d.get('hook_event_name', '')
# Cursor puts 'command' at top level for beforeShellExecution
# Normalize to tool_name + tool_input format for GuardClaw server
out = dict(d)
if hook_event == 'beforeShellExecution':
    out['tool_name'] = 'terminal'
    out['tool_input'] = {'command': d.get('command', '')}
elif hook_event == 'beforeMCPExecution':
    out['tool_name'] = d.get('serverName', 'mcp')
    out['tool_input'] = d.get('arguments', {})
print(json.dumps(out))
" 2>/dev/null)

# Use normalized input if available, otherwise original
if [ -n "$NORMALIZED" ]; then
  SEND_DATA="$NORMALIZED"
else
  SEND_DATA="$INPUT"
fi

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${GUARDCLAW_URL}/api/hooks/cursor/pre-tool-use" \
  -H "Content-Type: application/json" \
  -d "$SEND_DATA" \
  --connect-timeout 3 \
  --max-time 310 2>/dev/null)

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

# If GuardClaw is unreachable, allow (fail-open)
if [ -z "$HTTP_CODE" ] || [ "$HTTP_CODE" = "000" ]; then
  echo '{"permission":"allow","userMessage":"GuardClaw: server unreachable, fail-open"}'
  exit 0
fi

# Parse response and convert to Cursor format
export GUARDCLAW_HOOK_INPUT="$INPUT"
echo "$BODY" | python3 -c "
import sys, json, os, subprocess

try:
    d = json.load(sys.stdin)
except:
    print(json.dumps({'permission':'allow'}))
    sys.exit(0)

# Parse original hook input for tool info
try:
    hook_input = json.loads(os.environ.get('GUARDCLAW_HOOK_INPUT', '{}'))
except:
    hook_input = {}

permission = d.get('permission', 'allow')
user_message = d.get('user_message', '')
hook_event = hook_input.get('hook_event_name', '')
command = hook_input.get('command', '')

# macOS notification for every analysis
if user_message:
    try:
        safe_msg = user_message[:200].replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"')
        title = 'GuardClaw BLOCK' if permission == 'deny' else 'GuardClaw'
        subprocess.Popen([
            'osascript', '-e',
            'display notification \"' + safe_msg + '\" with title \"' + title + '\"'
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except:
        pass

if permission == 'deny':
    out = {'permission': 'deny'}
    if user_message:
        out['userMessage'] = user_message
        out['agentMessage'] = user_message
    print(json.dumps(out))
    sys.exit(2)

out = {'permission': 'allow'}
if user_message:
    out['userMessage'] = user_message
    out['agentMessage'] = user_message

    # For shell hooks: inject analysis into command output via modified_command
    if command and hook_event == 'beforeShellExecution':
        # Escape single quotes for shell
        esc = user_message.replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))
        out['modifiedCommand'] = \"printf '%%s\\\\n' '\" + esc + \"'; \" + command

print(json.dumps(out))
" 2>/dev/null

# If python3 failed, fallback allow
if [ $? -ne 0 ] && [ $? -ne 2 ]; then
  echo '{"permission":"allow"}'
fi
