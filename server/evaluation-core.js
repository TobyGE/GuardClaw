// Evaluation Core — Shared tool evaluation pipeline used by all agent hook handlers.
// Extracts the common steps: memory lookup, auto-approve, LLM dispatch, memory adjustment,
// event store write, and verdict determination.

/**
 * Evaluate a tool call through the full pipeline.
 *
 * @param {Object} opts - Tool call details
 * @param {string} opts.gcToolName - Normalized tool name (exec, read, write, etc.)
 * @param {Object} opts.gcParams - Normalized tool params
 * @param {string} opts.sessionKey - Session key for chain/memory tracking
 * @param {string} opts.source - Agent source identifier ('cc', 'gemini', 'cursor', 'opencode', 'oc')
 * @param {string} opts.eventType - Event type for store ('claude-code-tool', 'gemini-tool', etc.)
 * @param {string} opts.backend - Backend label for safeguard ('claude-code', 'gemini-cli', 'cursor', 'opencode')
 * @param {string|null} [opts.originalToolName] - Original agent-specific tool name
 * @param {Object|null} [opts.taskContext] - Task context (userPrompt, cwd, recentTools)
 * @param {Object|null} [opts.skillInfo] - For skill tools: { skillName, skillContent }
 *
 * @param {Object} deps - Injected dependencies (services/stores from index.js)
 * @param {Object} deps.safeguardService
 * @param {Object} deps.memoryStore
 * @param {Object} deps.eventStore
 * @param {Function} deps.getChainHistory - (sessionKey, toolName) => chainHistory | null
 * @param {boolean} deps.blockingEnabled
 * @param {Function} [deps.formatDisplayInput] - (toolName, params) => string
 *
 * @returns {Promise<{analysis, memoryHint, displayInput, verdict, eventId}>}
 */
export async function evaluateToolCall(opts, deps) {
  const {
    gcToolName,
    gcParams,
    sessionKey,
    source,
    eventType,
    backend,
    originalToolName,
    taskContext = null,
    skillInfo = null,
  } = opts;

  const {
    safeguardService,
    memoryStore,
    eventStore,
    getChainHistory,
    blockingEnabled,
    formatDisplayInput,
  } = deps;

  // 1. Chain history
  const chainHistory = getChainHistory(sessionKey, gcToolName);

  // 2. Command string for memory key
  const commandStr = gcToolName === 'exec' ? (gcParams.command || '') : JSON.stringify(gcParams);

  // 3. Memory lookup
  const mem = memoryStore.lookup(gcToolName, commandStr);
  let memoryHint = null;
  if (mem.found && (mem.approveCount + mem.denyCount) > 0) {
    memoryHint = {
      pattern: mem.pattern,
      approveCount: mem.approveCount,
      denyCount: mem.denyCount,
      confidence: mem.confidence,
      suggestedAction: mem.suggestedAction,
    };
  }

  // 4. Auto-approve from memory (skip LLM entirely)
  if (memoryHint && memoryHint.suggestedAction === 'auto-approve') {
    const baseScore = 5;
    const adj = memoryStore.getScoreAdjustment(gcToolName, commandStr, baseScore);
    const adjScore = Math.max(1, Math.min(10, baseScore + adj));
    if (adjScore < 9) {
      return {
        analysis: { riskScore: adjScore, reasoning: 'Auto-approved by memory', category: 'memory', backend: 'memory' },
        memoryHint,
        memoryAutoApproved: true,
        displayInput: null,
        verdict: 'memory-auto-approved',
        eventId: null,
        commandStr,
      };
    }
  }

  // 5. Memory context for LLM
  const relatedPatterns = memoryStore.lookupRelated(gcToolName, commandStr);
  const memoryContext = relatedPatterns.length > 0
    ? relatedPatterns.map(p => `- "${p.pattern}" — ${p.approveCount > p.denyCount ? 'safe' : 'risky'} (${p.approveCount}/${p.denyCount})`).join('\n')
    : null;

  // 6. LLM dispatch
  const jm = { sessionKey, source };
  let analysis;
  if (skillInfo) {
    analysis = await safeguardService.analyzeSkillContent(skillInfo.skillName, skillInfo.skillContent);
  } else if (gcToolName === 'exec') {
    analysis = await safeguardService.analyzeCommand(gcParams.command || '', chainHistory, memoryContext, taskContext, jm);
  } else {
    analysis = await safeguardService.analyzeToolAction(
      { tool: gcToolName, summary: JSON.stringify(gcParams), ...gcParams },
      chainHistory, memoryContext, taskContext, jm,
    );
  }

  // 7. Memory score adjustment
  if (memoryHint) {
    const adj = memoryStore.getScoreAdjustment(gcToolName, commandStr, analysis.riskScore);
    if (adj !== 0) {
      analysis.originalRiskScore = analysis.riskScore;
      analysis.riskScore = Math.max(1, Math.min(10, analysis.riskScore + adj));
    }
  }

  // 8. Display input
  const displayInput = formatDisplayInput
    ? formatDisplayInput(gcToolName, gcParams)
    : (gcToolName === 'exec' ? (gcParams.command || '') : JSON.stringify(gcParams));

  // 9. Verdict
  const isHighRisk = analysis.riskScore >= 8;
  const verdict = isHighRisk ? (blockingEnabled ? 'block' : 'pass-through') : 'auto-approved';

  // 10. Store event
  const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  eventStore.addEvent({
    id: eventId,
    type: eventType,
    tool: gcToolName,
    command: gcToolName === 'exec' ? (gcParams.command || '') : undefined,
    description: (typeof displayInput === 'string' ? displayInput : JSON.stringify(displayInput)).slice(0, 500),
    sessionKey,
    riskScore: analysis.riskScore,
    category: isHighRisk ? 'high-risk' : analysis.riskScore >= 4 ? 'warning' : 'safe',
    allowed: isHighRisk ? (eventType === 'claude-code-tool' ? null : 0) : 1,
    safeguard: {
      riskScore: analysis.riskScore,
      reasoning: analysis.reasoning,
      category: analysis.category,
      verdict,
      allowed: isHighRisk ? (eventType === 'claude-code-tool' ? null : analysis.riskScore < 8) : true,
      backend,
    },
    ...(eventType === 'claude-code-tool' ? {} : { timestamp: Date.now() }),
    ...(eventType === 'claude-code-tool' ? {
      data: JSON.stringify({
        toolName: gcToolName,
        originalToolName: originalToolName,
        payload: { params: gcParams },
        safeguard: { riskScore: analysis.riskScore, reasoning: analysis.reasoning, category: analysis.category, verdict },
        taskContext: taskContext || null,
        source,
        timestamp: Date.now(),
      }),
    } : {}),
  });

  return {
    analysis,
    memoryHint,
    memoryAutoApproved: false,
    displayInput,
    verdict,
    eventId,
    commandStr,
  };
}
