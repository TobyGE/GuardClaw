// Active Intervention — generates systemMessage guidance for the agent
// when risk is elevated but below the blocking threshold.
//
// Only effective for backends that support message injection:
// - Claude Code (systemMessage field in hook response)
// - OpenClaw (WebSocket message)

/**
 * Generate an intervention message for the agent based on current risk context.
 * Returns null if no intervention is needed.
 *
 * @param {object} analysis - scoring result with riskScore, reasoning, etc.
 * @param {object} signals - session signals (sensitiveDataAccessed, budgetExhausted, etc.)
 * @param {string} toolName
 * @param {object} params
 * @returns {string|null} systemMessage to inject, or null
 */
export function generateIntervention(analysis, signals, toolName, params) {
  if (!analysis || analysis.riskScore < 4 || analysis.riskScore >= 8) return null;
  if (!signals) return null;

  const parts = [];

  // Sensitive data warning
  if (signals.sensitiveDataAccessed && isNetworkTool(toolName, params)) {
    parts.push(
      `SECURITY: This session has accessed sensitive files (${signals.sensitiveFiles.slice(0, 3).join(', ')}). ` +
      `Do NOT include any credentials, keys, tokens, or file contents from those files in network requests. ` +
      `Use environment variable references instead of literal values.`
    );
  }

  // Budget warning
  if (signals.budgetExhausted) {
    parts.push(
      `NOTICE: This session has accumulated significant risk (${signals.cumulativeRisk}/${signals.riskBudget}). ` +
      `Subsequent operations are under heightened scrutiny. Prefer read-only and non-destructive actions.`
    );
  } else if (signals.cumulativeRisk >= signals.riskBudget * 0.8) {
    parts.push(
      `CAUTION: Session risk level is elevated (${signals.cumulativeRisk}/${signals.riskBudget}). ` +
      `Consider whether each operation is necessary before proceeding.`
    );
  }

  // Intent deviation warning
  if (analysis.intentDeviation) {
    parts.push(
      `WARNING: This action appears to deviate from the user's request. ` +
      `Please confirm with the user before proceeding with operations outside the stated task scope.`
    );
  }

  // Credential read + subsequent action
  if (signals.credentialRead && !isNetworkTool(toolName, params) && isDestructiveTool(toolName, params)) {
    parts.push(
      `SECURITY: Credentials were read earlier in this session. ` +
      `Do NOT modify, move, or delete credential files. If you need to update credentials, ask the user first.`
    );
  }

  if (parts.length === 0) return null;

  return `⛨ GuardClaw Safety Advisory:\n${parts.join('\n')}`;
}

function isNetworkTool(toolName, params) {
  if (toolName === 'web_fetch' || toolName === 'WebFetch') return true;
  if (toolName === 'exec' || toolName === 'Bash') {
    const cmd = params?.command || '';
    return /\b(curl|wget|nc|ncat|scp|rsync|ssh|ftp|sendmail)\b/.test(cmd);
  }
  return false;
}

function isDestructiveTool(toolName, params) {
  if (toolName === 'write' || toolName === 'edit') return true;
  if (toolName === 'exec' || toolName === 'Bash') {
    const cmd = params?.command || '';
    return /\b(rm|mv|chmod|chown|truncate|shred)\b/.test(cmd);
  }
  return false;
}
