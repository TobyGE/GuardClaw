# GuardClaw Intelligent Approval System 🛡️

## Overview

GuardClaw can now **truly block dangerous commands before execution** using Clawdbot's exec approval system. Instead of just monitoring commands after they run, GuardClaw intercepts approval requests and makes intelligent decisions based on LLM risk analysis.

## How It Works

```
1. Agent tries to execute a command
   ↓
2. Clawdbot sends exec.approval.requested
   ↓
3. GuardClaw intercepts the request
   ↓
4. LM Studio analyzes risk in real-time
   ↓
5. GuardClaw auto-approves or auto-blocks based on risk
   ↓
6. GuardClaw sends notification to dashboard (visible in event stream)
   ↓
7. Command executes (if allowed) or is denied (if blocked)
```

## User Notifications

When GuardClaw blocks a command, you'll see a **real-time notification** in the dashboard:

- 🛡️ **Blocked commands** appear with risk score and reasoning
- ⏸️ **Pending approvals** show approval ID and risk analysis (in prompt mode)
- ✅ **Approved commands** confirm user decisions
- ❌ **Denied commands** confirm user rejections

All notifications appear in the **Real-time Events** stream on the dashboard at http://localhost:3001

## Configuration

### Step 1: Enable Clawdbot Exec Approvals

Edit `~/.clawdbot/exec-approvals.json`:

```json
{
  "version": 1,
  "defaults": {
    "security": "allowlist",
    "ask": "always",
    "askFallback": "deny",
    "autoAllowSkills": true
  },
  "agents": {
    "main": {
      "security": "allowlist",
      "ask": "always",
      "askFallback": "deny",
      "autoAllowSkills": true,
      "allowlist": []
    }
  }
}
```

This tells Clawdbot to request approval for all exec commands.

### Step 2: Configure GuardClaw Mode

Add to `.env`:

```env
# Approval Mode
GUARDCLAW_APPROVAL_MODE=auto              # auto | prompt | monitor-only

# Risk Thresholds
GUARDCLAW_AUTO_ALLOW_THRESHOLD=6          # ≤6: auto-allow
GUARDCLAW_ASK_THRESHOLD=8                 # 7-8: ask user (prompt mode only)
GUARDCLAW_AUTO_BLOCK_THRESHOLD=9          # ≥9: auto-block
```

## Modes

### `auto` (Recommended)
- **Risk ≤ 6**: ✅ Auto-approve (safe commands like `ls`, `cat`, `grep`)
- **Risk 7-8**: 🚫 Auto-block (conservative - better safe than sorry)
- **Risk ≥ 9**: 🚫 Auto-block (dangerous like `rm -rf /`, `dd`)

### `prompt`
- **Risk ≤ 6**: ✅ Auto-approve
- **Risk 7-8**: ⏸️ Ask user for confirmation
- **Risk ≥ 9**: 🚫 Auto-block

### `monitor-only`
- 👀 Don't intercept approvals, just log and analyze
- Useful for testing without actually blocking commands

## Examples

### Auto-allowed (Risk 2/10)
```bash
ls -la
```
→ ✅ Allowed: "Read-only directory listing"

### Auto-blocked (Risk 8/10)
```bash
lsof -ti:3001 | xargs kill 2>/dev/null
```
→ 🚫 Blocked: "Forcefully kills processes using TCP port 3001"

### Auto-blocked (Risk 10/10)
```bash
rm -rf /
```
→ 🚫 Blocked: "Attempts to delete root filesystem"

## API Endpoints

### Get Approval Statistics
```bash
curl http://localhost:3001/api/approvals/stats
```

Response:
```json
{
  "total": 15,
  "autoAllowed": 10,
  "autoBlocked": 5,
  "userApproved": 0,
  "userDenied": 0,
  "pending": 0,
  "mode": "auto",
  "thresholds": {
    "autoAllow": 6,
    "ask": 8,
    "autoBlock": 9
  }
}
```

### Get Pending Approvals
```bash
curl http://localhost:3001/api/approvals/pending
```

### Manual Approval/Denial (Prompt Mode)
```bash
curl -X POST http://localhost:3001/api/approvals/resolve \
  -H "Content-Type: application/json" \
  -d '{"approvalId": "abc123", "action": "allow-once"}'
```

Actions: `allow-once`, `allow-always`, `deny`

## Testing

1. Start GuardClaw: `guardclaw start`
2. Try a safe command: `ls -la`
   - Should be auto-allowed
3. Try a dangerous command: `rm -rf /tmp/test-file`
   - Should be analyzed and blocked/allowed based on risk
4. Check stats: `curl http://localhost:3001/api/approvals/stats`

## Logs

GuardClaw logs all approval decisions:

```
[ApprovalHandler] 🔔 Approval request: abc-123
[ApprovalHandler]    Command: rm -rf /tmp/test
[ApprovalHandler] 🧠 Analyzing with LLM...
[ApprovalHandler] 📊 Risk Score: 8/10
[ApprovalHandler] 🚫 AUTO-BLOCKED (risk 8)
```

## Safety Notes

- GuardClaw blocks commands **before execution** - no undo needed
- LM Studio analyzes in milliseconds - minimal delay
- Conservative defaults: medium-risk commands are blocked in auto mode
- All decisions are logged for audit trail

## Troubleshooting

### Commands not being intercepted?

Check Clawdbot's exec-approvals.json:
```bash
cat ~/.clawdbot/exec-approvals.json
```

Ensure `ask: "always"` is set.

### GuardClaw not connected?

Check status:
```bash
curl http://localhost:3001/api/status | jq .approvals
```

Should show approval stats, not `null`.

### Want to see what would be blocked without actually blocking?

Set mode to `monitor-only`:
```env
GUARDCLAW_APPROVAL_MODE=monitor-only
```

This logs analysis results without intercepting approvals.
