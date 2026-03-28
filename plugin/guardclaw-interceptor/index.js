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
  // Chain analysis: correlate before_tool_call (has sessionKey) with
  // after_tool_call (sessionKey is undefined in context).
  const pendingResultKeys = new Map();

  // ─── Fail-closed: heartbeat state ────────────────────────────────────────
  let guardclawAvailable = true;
  let guardclawPid = null;
  let failClosedEnabled = true;
  let blockingEnabled = true;

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

  checkGuardClawHealth();
  setInterval(checkGuardClawHealth, 15000);

  // ─── before_tool_call: evaluate via GuardClaw server ─────────────────────
  // The server holds the response if approval is needed — the plugin just waits.
  // The agent never sees block/retry messages; it just experiences a longer eval.
  api.on('before_tool_call', async (event, context) => {
    // ── Fail-closed: block dangerous tools if GuardClaw is offline ──
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
        blockReason: '[GUARDCLAW FAIL-CLOSED] GuardClaw safety monitor is offline. Dangerous tool calls are blocked until it is restored.',
      };
    }
    if (!guardclawAvailable && OFFLINE_SAFE_TOOLS.has(event.toolName)) {
      return {};
    }

    // ── PID self-protection ──
    if (blockingEnabled && event.toolName === 'exec' && guardclawPid) {
      const cmd = event.params?.command || '';
      if (new RegExp(`kill\\b.*\\b${guardclawPid}\\b`).test(cmd) ||
          new RegExp(`pkill\\b.*\\b${guardclawPid}\\b`).test(cmd) ||
          /kill\s.*\$\(.*pgrep/.test(cmd) ||
          /kill\s.*`.*pgrep/.test(cmd) ||
          /pgrep.*\|\s*xargs\s+kill/.test(cmd) ||
          (/kill\b/.test(cmd) && /server\/index\.js|guardclaw/.test(cmd))) {
        api.logger.warn(`[GuardClaw] 🛡️ Blocked kill targeting GuardClaw PID ${guardclawPid}`);
        return {
          block: true,
          blockReason: `[GUARDCLAW SELF-PROTECTION] Blocked attempt to kill GuardClaw process (PID ${guardclawPid}).`,
        };
      }
    }

    // Store sessionKey mapping for after_tool_call correlation
    if (context.sessionKey) {
      const resultKey = `${event.toolName}:${JSON.stringify(event.params)}`;
      pendingResultKeys.set(resultKey, { sessionKey: context.sessionKey, timestamp: Date.now() });
      for (const [k, v] of pendingResultKeys) {
        if (Date.now() - v.timestamp > 5 * 60 * 1000) pendingResultKeys.delete(k);
      }
    }

    try {
      // Server holds this request if approval is needed (up to 5 min).
      // Timeout at 330s (5.5 min) to allow server's 5-min approval timeout to fire first.
      const response = await fetch(`${GUARDCLAW_URL}/api/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: event.toolName,
          params: event.params,
          sessionKey: context.sessionKey,
        }),
        signal: AbortSignal.timeout(330000),
      });

      if (!guardclawAvailable) {
        guardclawAvailable = true;
        api.logger.info('[GuardClaw] ✅ GuardClaw responded — protection restored');
      }

      const result = await response.json();

      // Server returns 'block' only after user explicitly denied
      if (result.action === 'block') {
        return {
          block: true,
          blockReason: `[GUARDCLAW] Tool blocked: ${result.reason || 'Denied by user'}`,
        };
      }

      // 'allow' — pass through (server already handled approval if needed)
      return {};
    } catch (err) {
      const msg = err.message || String(err);
      if (!failClosedEnabled) {
        api.logger.warn(`[GuardClaw] ⚠️ Evaluate failed (fail-open) — allowing through: ${msg}`);
        return {};
      }
      api.logger.warn(`[GuardClaw] ⚠️ Evaluate failed — blocking conservatively: ${msg}`);
      return {
        block: true,
        blockReason: `[GUARDCLAW] Could not get safety evaluation — blocking conservatively. Error: ${msg}`,
      };
    }
  });

  // ─── llm_input: capture user prompt + model info ─────────────────────────
  api.on('llm_input', async (event, context) => {
    const sessionKey = context.sessionKey || 'agent:main:main';
    fetch(`${GUARDCLAW_URL}/api/hooks/llm-input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionKey,
        runId: event.runId,
        provider: event.provider,
        model: event.model,
        prompt: event.prompt,
        imagesCount: event.imagesCount || 0,
        historyLength: Array.isArray(event.historyMessages) ? event.historyMessages.length : 0,
      }),
      signal: AbortSignal.timeout(2000),
    }).catch(err => api.logger.warn(`[GuardClaw] llm_input hook failed: ${err.message}`));
  });

  // ─── llm_output: capture token usage ─────────────────────────────────────
  api.on('llm_output', async (event, context) => {
    const sessionKey = context.sessionKey || 'agent:main:main';
    if (!event.usage) return;
    fetch(`${GUARDCLAW_URL}/api/hooks/llm-output`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionKey,
        runId: event.runId,
        provider: event.provider,
        model: event.model,
        usage: event.usage,
      }),
      signal: AbortSignal.timeout(2000),
    }).catch(err => api.logger.warn(`[GuardClaw] llm_output hook failed: ${err.message}`));
  });

  // ─── message_received: track incoming user messages ──────────────────────
  api.on('message_received', async (event, context) => {
    const rawKey = context.sessionKey ||
      (context.channelId ? `agent:main:${context.channelId}` : 'agent:main:main');
    const sessionKey = rawKey === 'agent:main:webchat' ? 'agent:main:main' : rawKey;
    fetch(`${GUARDCLAW_URL}/api/hooks/message-received`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionKey,
        from: event.from,
        content: event.content,
        timestamp: event.timestamp,
        metadata: event.metadata,
        channelId: context.channelId,
      }),
      signal: AbortSignal.timeout(2000),
    }).catch(err => api.logger.warn(`[GuardClaw] message_received hook failed: ${err.message}`));
  });

  // ─── message_sending: track outgoing agent replies ───────────────────────
  api.on('message_sending', async (event, context) => {
    const rawKey = context.sessionKey ||
      (context.channelId ? `agent:main:${context.channelId}` : 'agent:main:main');
    const sessionKey = rawKey === 'agent:main:webchat' ? 'agent:main:main' : rawKey;
    fetch(`${GUARDCLAW_URL}/api/hooks/message-sending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionKey,
        to: event.to,
        content: event.content,
        metadata: event.metadata,
      }),
      signal: AbortSignal.timeout(2000),
    }).catch(err => api.logger.warn(`[GuardClaw] message_sending hook failed: ${err.message}`));
    return {};
  });

  // ─── message_sent: log after agent reply is sent ─────────────────────────
  api.on('message_sent', async (event, context) => {
    const rawKey = context.sessionKey ||
      (context.channelId ? `agent:main:${context.channelId}` : 'agent:main:main');
    const sessionKey = rawKey === 'agent:main:webchat' ? 'agent:main:main' : rawKey;
    fetch(`${GUARDCLAW_URL}/api/hooks/message-sent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionKey,
        to: event.to,
        content: event.content,
        success: event.success,
        error: event.error,
      }),
      signal: AbortSignal.timeout(2000),
    }).catch(err => api.logger.warn(`[GuardClaw] message_sent hook failed: ${err.message}`));
  });

  // ─── after_tool_call: capture tool output for chain analysis ─────────────
  api.on('after_tool_call', async (event, _context) => {
    const resultKey = `${event.toolName}:${JSON.stringify(event.params)}`;
    const pending = pendingResultKeys.get(resultKey);
    if (!pending) return;
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
    } catch (err) {
      api.logger.warn(`[GuardClaw] Failed to store tool result: ${err.message}`);
    }
  });

  // ─── Approval commands: forward to GuardClaw server ──────────────────────
  // The server holds pending approvals; these commands resolve them.
  const resolveApproval = async (action, alwaysApprove = false) => {
    try {
      const res = await fetch(`${GUARDCLAW_URL}/api/approval/resolve-latest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, alwaysApprove, backend: 'openclaw' }),
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      return { text: data.message || (action === 'approve' ? '✅ Approved' : '❌ Denied') };
    } catch (err) {
      return { text: `❌ Failed to ${action}: ${err.message}` };
    }
  };

  api.registerCommand({ name: 'gc-approve', description: 'Approve the last blocked tool call', handler: () => resolveApproval('approve') });
  api.registerCommand({ name: 'gc-approve-always', description: 'Approve and always allow this pattern', handler: () => resolveApproval('approve', true) });
  api.registerCommand({ name: 'gc-deny', description: 'Deny the last blocked tool call', handler: () => resolveApproval('deny') });

  api.registerCommand({
    name: 'pending',
    description: 'List all pending blocked tool calls',
    handler: async () => {
      try {
        const res = await fetch(`${GUARDCLAW_URL}/api/approval/pending?backend=openclaw`, {
          signal: AbortSignal.timeout(3000),
        });
        const data = await res.json();
        if (!data.approvals || data.approvals.length === 0) {
          return { text: 'No pending blocked actions.' };
        }
        const lines = data.approvals.map((a, i) =>
          `${i + 1}. [${a.toolName}] ${a.displayInput}\n   Risk: ${a.riskScore}/10 — ${a.reason}`
        );
        return { text: `Pending blocked actions:\n\n${lines.join('\n\n')}` };
      } catch (err) {
        return { text: `❌ Failed to fetch pending approvals: ${err.message}` };
      }
    },
  });
}
