const GUARDCLAW_URL = process.env.GUARDCLAW_URL || 'http://localhost:3002';

export default function (api) {
  const pendingCalls = new Map();

  // Temporary whitelist for approved commands (5 min expiry)
  const approvedCommands = new Map(); // key: command hash, value: expiry timestamp

  api.on('before_tool_call', async (event, context) => {
    // Check if command is in approved whitelist
    const commandKey = `${event.toolName}:${JSON.stringify(event.params)}`;
    const approvalExpiry = approvedCommands.get(commandKey);

    if (approvalExpiry && Date.now() < approvalExpiry) {
      approvedCommands.delete(commandKey);
      api.logger.info(`[GuardClaw] Approved command executed: ${event.toolName}`);
      return {}; // Allow execution
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
          timestamp: Date.now(),
          riskScore: result.risk,
          reason: result.reason,
          details: result.details,
        };

        const sessionList = pendingCalls.get(context.sessionKey) || [];
        sessionList.push(callData);
        pendingCalls.set(context.sessionKey, sessionList);

        const globalList = pendingCalls.get('__global__') || [];
        globalList.push({ ...callData, sessionKey: context.sessionKey });
        pendingCalls.set('__global__', globalList);

        return {
          block: true,
          blockReason: `⚠️ High-risk action detected (risk score: ${result.risk}/10)\n\n${result.details}\n\nContinue?\n  /approve-last  - Approve and execute\n  /deny-last     - Deny and cancel\n  /pending       - View all pending actions`,
        };
      }
    } catch (err) {
      api.logger.warn(`GuardClaw check failed (is GuardClaw running?): ${err.message}`);
    }

    return {};
  });

  api.registerCommand({
    name: 'approve-last',
    description: 'Approve and execute the last blocked tool call',
    handler: (_ctx) => {
      const globalList = pendingCalls.get('__global__') || [];
      const call = globalList.pop();

      if (!call) {
        return { text: '❌ No pending actions' };
      }

      pendingCalls.set('__global__', globalList);

      if (call.sessionKey) {
        const sessionList = pendingCalls.get(call.sessionKey) || [];
        const index = sessionList.findIndex(
          (c) => c.toolName === call.toolName && c.timestamp === call.timestamp
        );
        if (index !== -1) {
          sessionList.splice(index, 1);
          pendingCalls.set(call.sessionKey, sessionList);
        }
      }

      const commandKey = `${call.toolName}:${JSON.stringify(call.params)}`;
      approvedCommands.set(commandKey, Date.now() + 5 * 60 * 1000);

      return { text: `✅ Approved: ${call.toolName}\n\nRe-send the original command within 5 minutes to execute.` };
    },
  });

  api.registerCommand({
    name: 'deny-last',
    description: 'Deny and cancel the last blocked tool call',
    handler: (_ctx) => {
      const globalList = pendingCalls.get('__global__') || [];
      const call = globalList.pop();

      if (!call) {
        return { text: 'No pending actions' };
      }

      pendingCalls.set('__global__', globalList);

      if (call.sessionKey) {
        const sessionList = pendingCalls.get(call.sessionKey) || [];
        const index = sessionList.findIndex(
          (c) => c.toolName === call.toolName && c.timestamp === call.timestamp
        );
        if (index !== -1) {
          sessionList.splice(index, 1);
          pendingCalls.set(call.sessionKey, sessionList);
        }
      }

      return { text: `❌ Denied: ${call.toolName}` };
    },
  });

  api.registerCommand({
    name: 'pending',
    description: 'View all pending blocked tool calls',
    handler: (_ctx) => {
      const globalList = pendingCalls.get('__global__') || [];
      if (globalList.length === 0) {
        return { text: 'No pending actions' };
      }
      const text = globalList
        .map((c, i) => `${i + 1}. ${c.toolName} (risk: ${c.riskScore}/10)\n   ${c.details}`)
        .join('\n\n');
      return { text };
    },
  });
}
