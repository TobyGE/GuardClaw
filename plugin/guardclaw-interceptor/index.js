const GUARDCLAW_URL = process.env.GUARDCLAW_URL || 'http://127.0.0.1:3002';

// Format tool params for display
function formatParams(toolName, params) {
  if (toolName === 'exec') return params.command || '';
  if (toolName === 'read' || toolName === 'write' || toolName === 'edit') {
    return params.file_path || params.path || '';
  }
  const str = JSON.stringify(params);
  return str.length > 120 ? str.slice(0, 120) + '…' : str;
}

export default function (api) {
  // pendingCalls: sessionKey → Array of pending blocked calls
  const pendingCalls = new Map();

  // Approved whitelist: commandKey → expiry timestamp (5 min)
  const approvedCommands = new Map();

  // Run-level lock: once a tool in a session is blocked, all subsequent
  // tool calls in that session are silently blocked (no LLM, no notification)
  // until the user approves or denies. Cleared on /approve-last or /deny-last.
  // Auto-expires after 10 minutes as a safety net.
  const blockedSessions = new Map(); // sessionKey → { since, firstBlock }

  // Chain analysis: correlate before_tool_call (has sessionKey) with
  // after_tool_call (sessionKey is undefined in context).
  // Key: `toolName:JSON.stringify(params)` → { sessionKey, timestamp }
  const pendingResultKeys = new Map();

  // ─── Fail-closed: heartbeat state ────────────────────────────────────────
  // Start optimistic (true) so plugin doesn't block on startup before first
  // health check completes. Flips to false as soon as GuardClaw is unreachable.
  let guardclawAvailable = true;
  let guardclawPid = null; // fetched from /api/health, used for PID-based kill detection
  let failClosedEnabled = false; // default OFF — synced from /api/health every 15s; opt-in via dashboard
  let blockingEnabled = true;   // cached from /api/health; false = monitor mode (no blocking)

  const checkGuardClawHealth = async () => {
    try {
      const res = await fetch(`${GUARDCLAW_URL}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        if (!guardclawAvailable) {
          api.logger.info('[GuardClaw] ✅ GuardClaw back online — protection restored');
        }
        guardclawAvailable = true;
        if (data.pid) guardclawPid = data.pid;
        if (typeof data.failClosed === 'boolean') failClosedEnabled = data.failClosed;
        if (typeof data.blockingEnabled === 'boolean') blockingEnabled = data.blockingEnabled;
      } else {
        if (guardclawAvailable) api.logger.warn('[GuardClaw] ⚠️ GuardClaw health check failed — entering fail-closed mode');
        guardclawAvailable = false;
      }
    } catch {
      if (guardclawAvailable) api.logger.warn('[GuardClaw] ⚠️ GuardClaw unreachable — entering fail-closed mode');
      guardclawAvailable = false;
    }
  };

  // Run immediately (to grab PID + confirm GuardClaw is alive), then every 15s
  checkGuardClawHealth();
  setInterval(checkGuardClawHealth, 15000);
  // ─────────────────────────────────────────────────────────────────────────

  api.on('before_tool_call', async (event, context) => {
    // ── Fail-closed: block dangerous tools if GuardClaw is offline ────────
    // Read-only / clearly safe tools are allowed through even when offline —
    // they carry no meaningful risk and blocking them makes the agent unusable.
    const OFFLINE_SAFE_TOOLS = new Set([
      'read', 'memory_search', 'memory_get',
      'web_search', 'web_fetch', 'image',
      'session_status', 'sessions_list', 'sessions_history',
      'tts',
    ]);
    if (!guardclawAvailable && failClosedEnabled && blockingEnabled && !OFFLINE_SAFE_TOOLS.has(event.toolName)) {
      api.logger.warn(`[GuardClaw] 🔴 Blocking ${event.toolName} — GuardClaw is offline (fail-closed)`);
      return {
        block: true,
        blockReason: [
          '[GUARDCLAW FAIL-CLOSED] GuardClaw safety monitor is offline.',
          'Dangerous tool calls are blocked until it is restored.',
          'Ask the user to restart GuardClaw: guardclaw start',
        ].join(' '),
      };
    }

    // Allow OFFLINE_SAFE_TOOLS through immediately when GuardClaw is unavailable —
    // without this, they'd fall through to /api/evaluate, which throws → conservative block.
    if (!guardclawAvailable && OFFLINE_SAFE_TOOLS.has(event.toolName)) {
      return {};
    }

    // ── PID self-protection: block kill commands targeting GuardClaw ───────
    // Only active in blocking mode — in monitor mode, agent can restart GuardClaw freely.
    if (blockingEnabled && event.toolName === 'exec' && guardclawPid) {
      const cmd = event.params?.command || '';
      if (new RegExp(`kill\\b.*\\b${guardclawPid}\\b`).test(cmd) ||
          new RegExp(`pkill\\b.*\\b${guardclawPid}\\b`).test(cmd)) {
        api.logger.warn(`[GuardClaw] 🛡️ Blocked kill targeting GuardClaw PID ${guardclawPid}`);
        return {
          block: true,
          blockReason: `[GUARDCLAW SELF-PROTECTION] Blocked attempt to kill GuardClaw process (PID ${guardclawPid}).`,
        };
      }
    }
    // ─────────────────────────────────────────────────────────────────────
    // Store sessionKey mapping for after_tool_call correlation (context.sessionKey is undefined there)
    if (context.sessionKey) {
      const resultKey = `${event.toolName}:${JSON.stringify(event.params)}`;
      pendingResultKeys.set(resultKey, { sessionKey: context.sessionKey, timestamp: Date.now() });
      // Clean up stale keys older than 5 minutes
      for (const [k, v] of pendingResultKeys) {
        if (Date.now() - v.timestamp > 5 * 60 * 1000) pendingResultKeys.delete(k);
      }
    }

    const commandKey = `${event.toolName}:${JSON.stringify(event.params)}`;
    const approvalExpiry = approvedCommands.get(commandKey);

    if (approvalExpiry && Date.now() < approvalExpiry) {
      approvedCommands.delete(commandKey);
      api.logger.info(`[GuardClaw] ✅ Approved command executing: ${event.toolName}`);
      return {};
    }

    // Check run-level lock: if this session already has a block pending,
    // silently block all subsequent tools — no LLM call, no extra notification.
    const sessionLock = blockedSessions.get(context.sessionKey);
    if (sessionLock) {
      const ageMin = (Date.now() - sessionLock.since) / 60000;
      if (ageMin < 10) {
        api.logger.info(
          `[GuardClaw] 🔒 Session locked — silently blocking ${event.toolName} (pending approval for ${sessionLock.firstBlock})`
        );
        return {
          block: true,
          blockReason: `[GUARDCLAW SAFETY BLOCK] Session is locked pending user approval for a previous blocked tool call (${sessionLock.firstBlock}). Wait silently.`,
        };
      } else {
        // Lock expired — clear it and proceed normally
        api.logger.info(`[GuardClaw] ⏰ Session lock expired, clearing for ${context.sessionKey}`);
        blockedSessions.delete(context.sessionKey);
      }
    }

    try {
      const response = await fetch(`${GUARDCLAW_URL}/api/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: event.toolName,
          params: event.params,
          sessionKey: context.sessionKey,
        }),
        signal: AbortSignal.timeout(30000), // 30s — matches LLM timeout on server side
      });

      // Successful response — GuardClaw is alive; fast-restore if previously offline
      if (!guardclawAvailable) {
        guardclawAvailable = true;
        api.logger.info('[GuardClaw] ✅ GuardClaw responded — protection restored');
      }

      const result = await response.json();

      if (result.action === 'ask') {
        const callData = {
          toolName: event.toolName,
          params: event.params,
          sessionKey: context.sessionKey,
          timestamp: Date.now(),
          riskScore: result.risk,
          reason: result.reason,
        };

        const sessionList = pendingCalls.get(context.sessionKey) || [];
        sessionList.push(callData);
        pendingCalls.set(context.sessionKey, sessionList);

        const globalList = pendingCalls.get('__global__') || [];
        globalList.push(callData);
        pendingCalls.set('__global__', globalList);

        // Lock this session so subsequent tool calls in the same run are silently blocked
        blockedSessions.set(context.sessionKey, {
          since: Date.now(),
          firstBlock: event.toolName,
        });
        api.logger.info(`[GuardClaw] 🔒 Session locked: ${context.sessionKey} (first block: ${event.toolName})`);

        const displayInput = formatParams(event.toolName, event.params);

        // Inject a direct user-facing message — don't rely on agent to relay info
        const riskEmoji = result.risk >= 9 ? '🔴' : '🟠';
        const chainLine = result.chainRisk ? `**⛓️ Chain Risk:** Dangerous sequence detected in session history\n` : '';
        const memoryLine = result.memory
          ? `**🧠 Memory:** ${result.memory.approveCount > 0 ? `Approved similar ${result.memory.approveCount}×` : ''}${result.memory.approveCount > 0 && result.memory.denyCount > 0 ? ', ' : ''}${result.memory.denyCount > 0 ? `Denied similar ${result.memory.denyCount}×` : ''}${result.memoryAdjustment ? ` (score ${result.originalRisk}→${result.risk})` : ''}\n`
          : '';
        const userMsg = [
          `🛡️ **GuardClaw blocked a tool call**`,
          ``,
          `**Tool:** \`${event.toolName}\``,
          `**Input:** \`${displayInput}\``,
          `**Risk Score:** ${riskEmoji} ${result.risk}/10`,
          chainLine,
          memoryLine,
          `**Reason:** ${result.reason}`,
          ``,
          `What would you like to do?`,
          `• \`/approve-last\` — Allow this once`,
          `• \`/deny-last\` — Cancel`,
        ].join('\n');

        // Fire-and-forget: inject directly to user, don't block the hook response
        fetch(`${GUARDCLAW_URL}/api/chat-inject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionKey: context.sessionKey,
            message: userMsg,
          }),
          signal: AbortSignal.timeout(3000),
        }).catch(err => api.logger.warn(`[GuardClaw] Failed to inject block notice: ${err.message}`));

        // Block reason for the agent: minimal, just instructs to wait for retry signal
        const blockMsg = [
          `[GUARDCLAW SAFETY BLOCK] Tool call intercepted.`,
          `Tool: ${event.toolName} | Input: ${displayInput} | Risk: ${result.risk}/10`,
          `A notification has been sent to the user with details and options.`,
          `Wait silently. If the user approves, you will receive [GUARDCLAW RETRY APPROVED] — retry immediately when you see it.`,
        ].join('\n');

        return { block: true, blockReason: blockMsg };
      }
    } catch (err) {
      // Evaluate failed (timeout, network error, etc.)
      // Behaviour is controlled by failClosedEnabled:
      //   true  → block conservatively (fail-closed)
      //   false → allow through with a warning (fail-open, default)
      // Do NOT set guardclawAvailable = false here; let the heartbeat own that state.
      const msg = err.message || String(err);
      if (!failClosedEnabled) {
        api.logger.warn(`[GuardClaw] ⚠️ Evaluate failed (fail-open) — allowing through: ${msg}`);
        return {};
      }
      api.logger.warn(`[GuardClaw] ⚠️ Evaluate failed — blocking conservatively: ${msg}`);
      return {
        block: true,
        blockReason: [
          '[GUARDCLAW] Could not get safety evaluation — blocking conservatively.',
          `Error: ${msg}`,
          'If GuardClaw is offline, run: guardclaw start',
        ].join(' '),
      };
    }

    return {};
  });

  // ─── after_tool_call: capture tool output for chain analysis ───────────────
  api.on('after_tool_call', async (event, _context) => {
    const resultKey = `${event.toolName}:${JSON.stringify(event.params)}`;
    const pending = pendingResultKeys.get(resultKey);
    if (!pending) return; // no matching before_tool_call recorded
    pendingResultKeys.delete(resultKey);

    const { sessionKey } = pending;
    try {
      await fetch(`${GUARDCLAW_URL}/api/tool-result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionKey,
          toolName: event.toolName,
          params: event.params,
          result: event.result,
          durationMs: event.durationMs,
        }),
        signal: AbortSignal.timeout(2000),
      });
      api.logger.info(`[GuardClaw] ⛓️  Result stored: ${event.toolName} (${sessionKey})`);
    } catch (err) {
      api.logger.warn(`[GuardClaw] Failed to store tool result: ${err.message}`);
    }
  });

  api.registerCommand({
    name: 'approve-last',
    description: 'Approve the last blocked tool call (auto-retries)',
    handler: async (_ctx) => {
      const globalList = pendingCalls.get('__global__') || [];
      const call = globalList.pop();

      if (!call) {
        return { text: '❌ No pending blocked actions.' };
      }

      pendingCalls.set('__global__', globalList);

      // Remove from session list
      if (call.sessionKey) {
        const sessionList = pendingCalls.get(call.sessionKey) || [];
        const idx = sessionList.findIndex(
          (c) => c.toolName === call.toolName && c.timestamp === call.timestamp
        );
        if (idx !== -1) {
          sessionList.splice(idx, 1);
          pendingCalls.set(call.sessionKey, sessionList);
        }

        // Clear the session lock so new tool calls are allowed through again
        blockedSessions.delete(call.sessionKey);
        api.logger.info(`[GuardClaw] 🔓 Session unlocked: ${call.sessionKey}`);
      }

      // Add to whitelist (5 min)
      const commandKey = `${call.toolName}:${JSON.stringify(call.params)}`;
      approvedCommands.set(commandKey, Date.now() + 5 * 60 * 1000);

      // Inject retry signal into the agent session via GuardClaw
      const displayInput = formatParams(call.toolName, call.params);
      try {
        await fetch(`${GUARDCLAW_URL}/api/chat-inject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionKey: call.sessionKey,
            message: `[GUARDCLAW RETRY APPROVED] The user approved the blocked action. Retry it now immediately.\nTool: ${call.toolName}\nInput: ${displayInput}`,
          }),
          signal: AbortSignal.timeout(3000),
        });
      } catch (err) {
        api.logger.warn(`[GuardClaw] Failed to inject retry signal: ${err.message}`);
        // Still approved — user may need to ask agent to retry manually
        return {
          text: `✅ Approved: ${call.toolName} (${displayInput})\n\n⚠️ Auto-retry signal failed — please ask the agent to retry manually.`,
        };
      }

      // Record to GuardClaw memory
      fetch(`${GUARDCLAW_URL}/api/memory/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: call.toolName, command: displayInput, riskScore: call.riskScore, decision: 'approve', sessionKey: call.sessionKey }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});

      return {
        text: `✅ Approved — retrying ${call.toolName} now.\n\nInput: ${displayInput}`,
      };
    },
  });

  api.registerCommand({
    name: 'deny-last',
    description: 'Deny the last blocked tool call',
    handler: (_ctx) => {
      const globalList = pendingCalls.get('__global__') || [];
      const call = globalList.pop();

      if (!call) {
        return { text: 'No pending blocked actions.' };
      }

      pendingCalls.set('__global__', globalList);

      if (call.sessionKey) {
        const sessionList = pendingCalls.get(call.sessionKey) || [];
        const idx = sessionList.findIndex(
          (c) => c.toolName === call.toolName && c.timestamp === call.timestamp
        );
        if (idx !== -1) {
          sessionList.splice(idx, 1);
          pendingCalls.set(call.sessionKey, sessionList);
        }

        // Clear the session lock
        blockedSessions.delete(call.sessionKey);
        api.logger.info(`[GuardClaw] 🔓 Session unlocked (denied): ${call.sessionKey}`);
      }

      const displayInput = formatParams(call.toolName, call.params);

      // Record to GuardClaw memory
      fetch(`${GUARDCLAW_URL}/api/memory/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: call.toolName, command: displayInput, riskScore: call.riskScore, decision: 'deny', sessionKey: call.sessionKey }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});

      return { text: `❌ Denied: ${call.toolName} (${displayInput})` };
    },
  });

  api.registerCommand({
    name: 'pending',
    description: 'List all pending blocked tool calls',
    handler: (_ctx) => {
      const globalList = pendingCalls.get('__global__') || [];
      if (globalList.length === 0) {
        return { text: 'No pending blocked actions.' };
      }
      const lines = globalList.map((c, i) => {
        const input = formatParams(c.toolName, c.params);
        return `${i + 1}. [${c.toolName}] ${input}\n   Risk: ${c.riskScore}/10 — ${c.reason}`;
      });
      return { text: `Pending blocked actions:\n\n${lines.join('\n\n')}` };
    },
  });
}
