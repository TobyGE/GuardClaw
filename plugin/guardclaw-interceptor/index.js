const GUARDCLAW_URL = process.env.GUARDCLAW_URL || 'http://localhost:3002';

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

  api.on('before_tool_call', async (event, context) => {
    const commandKey = `${event.toolName}:${JSON.stringify(event.params)}`;
    const approvalExpiry = approvedCommands.get(commandKey);

    if (approvalExpiry && Date.now() < approvalExpiry) {
      approvedCommands.delete(commandKey);
      api.logger.info(`[GuardClaw] ✅ Approved command executing: ${event.toolName}`);
      return {};
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
        signal: AbortSignal.timeout(2000),
      });

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

        // Clear block message: shown to the LLM agent
        const displayInput = formatParams(event.toolName, event.params);
        const blockMsg = [
          `[GUARDCLAW SAFETY BLOCK]`,
          `Tool:       ${event.toolName}`,
          `Input:      ${displayInput}`,
          `Risk Score: ${result.risk}/10`,
          `Reason:     ${result.reason}`,
          ``,
          `This tool call was intercepted before execution.`,
          `Tell the user clearly what was blocked and why, then ask:`,
          `  1. Allow this execution`,
          `  2. Deny it`,
          ``,
          `IMPORTANT: If the user allows it, you will immediately receive a`,
          `[GUARDCLAW RETRY APPROVED] signal. When you see that signal,`,
          `retry this exact tool call right away — do not wait for further input.`,
        ].join('\n');

        return { block: true, blockReason: blockMsg };
      }
    } catch (err) {
      api.logger.warn(`[GuardClaw] Check failed (is GuardClaw running?): ${err.message}`);
    }

    return {};
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
      }

      const displayInput = formatParams(call.toolName, call.params);
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
