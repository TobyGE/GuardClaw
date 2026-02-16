# OpenClaw Pre-Execution Integration

## 🎯 Overview

This guide enables **real-time tool execution control** in OpenClaw. GuardClaw will analyze tools BEFORE they execute and can block dangerous operations.

## 📊 How It Works

```
┌─────────────┐    ①     ┌─────────────┐    ②     ┌──────────────┐
│   OpenClaw  │ ───────> │  GuardClaw  │ ───────> │ Risk Analysis│
│             │  tool    │   Plugin    │  check   │   (LLM)      │
│  Agent Run  │  call    │             │  tool    │              │
└─────────────┘          └─────────────┘          └──────────────┘
       │                        │                         │
       │                        │ ③ decision              │
       │                        │ (allow/block)           │
       │                        v                         │
       │                  ┌──────────┐                    │
       │ ④ execute        │  Result  │                    │
       │   or block       │  {allowed│<───────────────────┘
       └─────────────────>│  riskScore}
                          └──────────┘
```

**Flow:**
1. OpenClaw agent calls a tool (e.g., `exec`, `write`)
2. Plugin intercepts BEFORE execution, sends to GuardClaw API
3. GuardClaw analyzes risk using LLM + whitelist/blacklist
4. Returns decision: `{allowed: true/false, riskScore, reason}`
5. If blocked → tool throws error, execution stops
6. If allowed → tool executes normally

## 🚀 Installation

### Step 1: Copy Plugin File

```bash
# Plugin is already created at:
~/openclaw/plugins/guardclaw-plugin.mjs
```

### Step 2: Enable Plugin in OpenClaw Config

Edit `~/.openclaw/openclaw.json` and add:

```json
{
  "plugins": [
    "./plugins/guardclaw-plugin.mjs"
  ]
}
```

Or if you already have plugins:

```json
{
  "plugins": [
    "./path/to/existing-plugin.mjs",
    "./plugins/guardclaw-plugin.mjs"
  ]
}
```

### Step 3: Configure Environment Variables (Optional)

Create or edit `~/.openclaw/.env`:

```bash
# GuardClaw URL (default: http://localhost:3002)
GUARDCLAW_URL=http://localhost:3002

# Timeout for GuardClaw check in ms (default: 5000)
GUARDCLAW_TIMEOUT=5000

# Enable/disable GuardClaw (default: true)
GUARDCLAW_ENABLED=true
```

### Step 4: Configure Risk Thresholds in GuardClaw

Edit `~/clawd/.env`:

```bash
# Auto-allow tools with risk score <= 6 (default: 6)
GUARDCLAW_AUTO_ALLOW_THRESHOLD=6

# Auto-block tools with risk score >= 9 (default: 9)
GUARDCLAW_AUTO_BLOCK_THRESHOLD=9
```

**Risk Score Scale:** 0-10
- 0-3: Safe (green)
- 4-6: Low risk (yellow)  
- 7-8: Medium risk (orange, requires review)
- 9-10: High risk (red, auto-blocked)

### Step 5: Restart OpenClaw

```bash
openclaw gateway restart
```

## ✅ Verification

### Test 1: Safe Command (Should Allow)

In OpenClaw chat:
```
Run: echo "hello world"
```

**Expected:**
- GuardClaw logs: `✅ Allowed: exec (risk: 1)`
- Command executes normally

### Test 2: Dangerous Command (Should Block)

In OpenClaw chat:
```
Run: rm -rf /
```

**Expected:**
- GuardClaw logs: `🚫 BLOCKED: exec (risk: 10)`
- OpenClaw shows error: `🛡️ GuardClaw: Extremely dangerous operation (risk score: 10)`
- Command does NOT execute

### Check Logs

**OpenClaw logs:**
```bash
tail -f ~/.openclaw/logs/gateway.log | grep GuardClaw
```

**GuardClaw logs:**
```bash
tail -f ~/clawd/live.log | grep "Pre-execution\|Tool check"
```

## 🎛️ Configuration Options

### Fail-Open vs Fail-Closed

**Current behavior (Fail-Open):**
- If GuardClaw is unreachable → allow tool execution
- If analysis times out → allow tool execution
- **Prioritizes availability over security**

**To enable Fail-Closed (maximum security):**

Edit `~/openclaw/plugins/guardclaw-plugin.mjs`:

```javascript
// Change line ~46 and ~56:
// FROM:
return { allowed: true };

// TO:
return { allowed: false, reason: 'GuardClaw unavailable' };
```

### Whitelist/Blacklist

Tools can be permanently whitelisted or blacklisted:

**Via GuardClaw UI:**
1. Open http://localhost:3002
2. Click event → "🚫 Block" or "✅ Whitelist"

**Via API:**
```bash
# Add to blacklist
curl -X POST http://localhost:3002/api/blocking/blacklist \
  -H "Content-Type: application/json" \
  -d '{"tool":"exec","params":{"command":"rm -rf /"}}'

# Add to whitelist
curl -X POST http://localhost:3002/api/blocking/whitelist \
  -H "Content-Type: application/json" \
  -d '{"tool":"read","params":{"file_path":"MEMORY.md"}}'
```

## 🔧 Troubleshooting

### Plugin Not Loading

**Check:**
```bash
grep "guardclaw" ~/.openclaw/openclaw.json
```

**Verify plugin syntax:**
```bash
node ~/openclaw/plugins/guardclaw-plugin.mjs
# Should output: no errors
```

### GuardClaw API Not Responding

**Check GuardClaw is running:**
```bash
curl http://localhost:3002/api/status
```

**Check network:**
```bash
curl -X POST http://localhost:3002/api/check-tool \
  -H "Content-Type: application/json" \
  -d '{"toolName":"exec","params":{"command":"echo test"}}'
```

**Expected response:**
```json
{
  "allowed": true,
  "riskScore": 1,
  "reason": "Safe",
  "category": "safe"
}
```

### All Tools Being Blocked

**Check thresholds:**
```bash
grep "THRESHOLD" ~/clawd/.env
```

**Temporarily disable:**
```bash
# In ~/.openclaw/.env
GUARDCLAW_ENABLED=false
```

Then restart OpenClaw.

## 📊 Performance Impact

**Typical latency:**
- Whitelist/blacklist check: <1ms
- LLM analysis (qwen3-1.7b): 100-500ms
- Total overhead: 100-500ms per tool call

**Optimization:**
- Whitelist frequently-used safe tools
- Use faster LLM models
- Increase timeout for slow networks

## 🎓 Advanced: Custom Risk Logic

You can customize the decision logic in GuardClaw:

Edit `~/clawd/server/index.js`, find the `/api/check-tool` endpoint and modify:

```javascript
// Example: Block all file deletions
if (toolName === 'exec' && params.command?.includes('rm ')) {
  return res.json({ 
    allowed: false, 
    riskScore: 10, 
    reason: 'File deletions are disabled' 
  });
}

// Example: Always allow reads
if (toolName === 'read') {
  return res.json({ 
    allowed: true, 
    riskScore: 0, 
    reason: 'Reads always safe' 
  });
}
```

## 📝 Architecture Notes

### Why Not Just Modify OpenClaw Directly?

**Separation of Concerns:**
- OpenClaw = AI agent runtime
- GuardClaw = Safety monitoring layer

**Benefits:**
1. GuardClaw can monitor multiple agents
2. Easy to enable/disable without rebuilding OpenClaw
3. Safety logic separate from execution logic
4. Can swap GuardClaw for other safety systems

### Limitations

**Race Conditions:**
- Very fast tools may start before check completes
- Solution: Adjust `GUARDCLAW_TIMEOUT` higher

**Async Tools:**
- `process` tool runs in background
- Check happens at start, not during execution
- Solution: Monitor via streaming events

**Plugin Overhead:**
- Every tool call adds ~100-500ms latency
- Solution: Whitelist safe, frequently-used tools

## 📚 Related Documentation

- [GuardClaw README](./README.md)
- [OpenClaw Plugin API](https://docs.openclaw.ai/plugins)
- [Safety Architecture](./docs/SAFETY.md)

## 🤝 Contributing

To improve the integration:

1. Test with more tool types
2. Optimize LLM prompts for accuracy
3. Add more sophisticated decision logic
4. Implement ML-based learning from decisions

**Submit improvements to:**
- GuardClaw: https://github.com/your-org/guardclaw
- OpenClaw: https://github.com/openclaw/openclaw
