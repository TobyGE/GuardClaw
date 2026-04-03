// Security Memory — Multi-level security memory system (Level 0 + Level 1).
//
// Level 0: Raw event buffer — append-only per session, tracks every tool call
//          with security-relevant digests and data flow tags.
// Level 1: AI-generated session brief — rolling summary that survives
//          context compression. Generated when raw buffer approaches 60K tokens.
//
// Replaces the old rule-based generateSecurityBrief().

import { countTokens } from './token-calculator.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const COMPRESSION_THRESHOLD_TOKENS = 60_000;
const BRIEF_MAX_TOKENS = 8_000; // truncate brief if exceeds this
const RAW_KEEPALIVE = 10; // keep last N raw events after compression
const MAX_SESSIONS = 200;

// ─── Data Flow Tagger (lightweight, no LLM) ────────────────────────────────

const CREDENTIAL_PATTERNS = /\b(api[_-]?key|secret|token|password|private[_-]?key|auth|bearer)\b/i;
const URL_PATTERN = /https?:\/\/([^/\s"']+)/;

function buildParamsDigest(toolName, params) {
  if (!params) return toolName;
  switch (toolName) {
    case 'exec': case 'Bash': case 'terminal':
      return (params.command || '').slice(0, 500);
    case 'read': case 'Read':
      return params.file_path || params.path || '';
    case 'write': case 'Write':
      return params.file_path || '';
    case 'edit': case 'Edit':
      return params.file_path || '';
    case 'web_fetch': case 'WebFetch':
      return params.url || '';
    case 'web_search': case 'WebSearch':
      return params.query || '';
    case 'glob': case 'Glob':
      return `${params.path || '.'} ${params.pattern || ''}`;
    case 'grep': case 'Grep':
      return `${params.path || '.'} ${params.pattern || ''}`;
    default:
      return JSON.stringify(params).slice(0, 200);
  }
}

function buildDataFlowTag(toolName, params) {
  const tags = [];
  const tn = (toolName || '').toLowerCase();

  if (tn === 'read' || tn === 'glob' || tn === 'grep') {
    const p = params?.file_path || params?.path || '';
    if (p) tags.push(`reads:${p}`);
  } else if (tn === 'write' || tn === 'edit') {
    const p = params?.file_path || params?.path || '';
    if (p) tags.push(`writes:${p}`);
  } else if (tn === 'web_fetch' || tn === 'webfetch') {
    const url = params?.url || '';
    const m = url.match(URL_PATTERN);
    if (m) tags.push(`fetches:${m[1]}`);
  } else if (tn === 'exec' || tn === 'bash' || tn === 'terminal') {
    const cmd = params?.command || '';

    // Network commands
    const urlMatch = cmd.match(URL_PATTERN);
    if (urlMatch) tags.push(`fetches:${urlMatch[1]}`);
    if (/\bcurl\b.*-d\s+@(\S+)/.test(cmd)) {
      const fileMatch = cmd.match(/-d\s+@(\S+)/);
      if (fileMatch) tags.push(`sends-file:${fileMatch[1]}`);
    }

    // File reads via cat/head/tail
    const catMatch = cmd.match(/\b(?:cat|head|tail|less)\s+(\S+)/);
    if (catMatch) tags.push(`reads:${catMatch[1]}`);

    // File writes via redirect
    const redirectMatch = cmd.match(/>\s*(\S+)/);
    if (redirectMatch) tags.push(`writes:${redirectMatch[1]}`);
  }

  // Check for credential content
  const digest = buildParamsDigest(toolName, params);
  if (CREDENTIAL_PATTERNS.test(digest)) tags.push('credential');

  return tags.length > 0 ? tags.join(',') : null;
}

// ─── AI Compression Prompt ──────────────────────────────────────────────────

const COMPRESSION_SYSTEM_PROMPT = `You are a security analyst monitoring an AI coding agent in real time.
You receive a PRIOR BRIEF (your previous assessment, may be empty) and NEW EVENTS (raw tool calls since last assessment).

Produce an updated SECURITY BRIEF covering:

## Data Flow
- Sensitive data accessed and where it went
- Trace: source (read) → transform (write temp) → exit (network/message)
- Flag INCOMPLETE chains (credentials read but no network call YET)

## Attack Chain Detection
- Sequences where individual steps look safe but combination is dangerous
- Include sequence numbers for temporal ordering

## Permission & Persistence Changes
- sudo, chmod, crontab, .bashrc, hooks, new SSH keys
- Anything that expands future capability

## Anomalies
- Deviations from stated user intent
- Unusual patterns (mass credential reading, rapid file enumeration)
- Denied operations being retried in different forms

## Risk Summary
- Cumulative risk trajectory (increasing/stable/decreasing)
- Top 3 active concerns
- What to watch for next

Rules:
- Include file paths, commands, URLs, timestamps — be specific
- PRESERVE information from PRIOR BRIEF — early signals must survive
- If nothing concerning, say so briefly
- Output 2000-4000 tokens
- Do NOT fabricate events not in input`;

// ─── Fallback (rule-based, when cloud judge unavailable) ────────────────────

function _fallbackBrief(sessionState, sessionSignals, eventStore, sessionKey) {
  const signals = sessionSignals?.getSignals(sessionKey);
  const events = eventStore?.getFilteredEvents(100, null, sessionKey);
  if ((!signals || signals.toolCount === 0) && (!events || events.length === 0)) return null;

  const lines = ['⛨ GuardClaw Security Brief (rule-based fallback):'];

  if (signals?.sensitiveDataAccessed && signals.sensitiveFiles?.length > 0) {
    lines.push(`⚠ Sensitive files accessed: ${signals.sensitiveFiles.join(', ')}`);
  }
  if (signals?.credentialRead) {
    lines.push('⚠ Credentials were read — network operations will be scrutinized.');
  }

  const highRisk = (events || []).filter(e => (e.safeguard?.riskScore ?? e.riskScore ?? 0) >= 7);
  if (highRisk.length > 0) {
    lines.push(`⚠ ${highRisk.length} high-risk operation(s):`);
    for (const e of highRisk.slice(-5)) {
      const tool = e.tool || '?';
      const score = e.safeguard?.riskScore ?? e.riskScore;
      const desc = (e.description || e.command || '').slice(0, 100);
      lines.push(`  - [score ${score}] ${tool}: ${desc}`);
    }
  }

  const denied = (events || []).filter(e => e.safeguard?.allowed === false);
  if (denied.length > 0) {
    lines.push(`🚫 ${denied.length} operation(s) denied — do not retry:`);
    for (const e of denied.slice(-3)) {
      lines.push(`  - ${e.tool || '?'}: ${(e.description || e.command || '').slice(0, 100)}`);
    }
  }

  // Raw buffer summary
  const buf = sessionState?.rawBuffer || [];
  if (buf.length > 0) {
    const dataFlows = buf.filter(e => e.dataFlowTag).map(e => `[${e.seq}] ${e.dataFlowTag}`);
    if (dataFlows.length > 0) {
      lines.push(`📊 Data flow trace (${dataFlows.length} tagged operations):`);
      for (const df of dataFlows.slice(-10)) lines.push(`  ${df}`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

// ─── SecurityMemory Class ───────────────────────────────────────────────────

export class SecurityMemory {
  constructor(cloudJudge, sessionSignalsRef, eventStoreRef) {
    this.cloudJudge = cloudJudge;
    this.sessionSignals = sessionSignalsRef;
    this.eventStore = eventStoreRef;
    this.sessions = new Map(); // sessionKey → session state
  }

  // ─── Level 0: Raw Event Buffer ──────────────────────────────────────────

  /**
   * Append a raw event to the session's buffer.
   * Called at PreToolUse (isComplete=false) with analysis results.
   * @returns {number} seq number for later markToolComplete
   */
  appendRawEvent(sessionKey, { toolName, params, riskScore, verdict, allowed, flags, resultDigest }) {
    const state = this._getState(sessionKey);
    const seq = state.nextSeq++;
    state.rawBuffer.push({
      seq,
      timestamp: Date.now(),
      toolName,
      paramsDigest: buildParamsDigest(toolName, params),
      resultDigest: resultDigest || '',
      riskScore: riskScore || 0,
      verdict: verdict || 'unknown',
      allowed: allowed ?? null,
      flags: flags || [],
      dataFlowTag: buildDataFlowTag(toolName, params),
      isComplete: false,
    });
    return seq;
  }

  /**
   * Mark a raw event as complete and update its result digest.
   * Called at PostToolUse. Also checks if compression should fire.
   */
  markToolComplete(sessionKey, seq, resultDigest) {
    const state = this.sessions.get(sessionKey);
    if (!state) return;
    const entry = state.rawBuffer.find(e => e.seq === seq);
    if (entry) {
      entry.isComplete = true;
      if (resultDigest) entry.resultDigest = resultDigest.slice(0, 600);
    }
    // Fire pending compression if threshold was crossed mid-tool-call
    if (state.compressionPending && this.isCompressionSafe(sessionKey)) {
      state.compressionPending = false;
      this.triggerCompression(sessionKey, 'deferred-threshold').catch(e =>
        console.error(`[SecurityMemory] Deferred compression failed: ${e.message}`)
      );
    }
  }

  /**
   * Estimate token count of uncompressed raw events.
   */
  getBufferTokenCount(sessionKey) {
    const state = this.sessions.get(sessionKey);
    if (!state) return 0;
    const uncompressed = state.rawBuffer.filter(e => e.seq > state.lastCompressedSeq);
    if (uncompressed.length === 0) return 0;
    const text = this._serializeForLLM(uncompressed);
    return countTokens(text);
  }

  // ─── Level 1: AI-Generated Session Brief ────────────────────────────────

  /**
   * Check if compression should be triggered.
   */
  shouldCompress(sessionKey) {
    return this.getBufferTokenCount(sessionKey) > COMPRESSION_THRESHOLD_TOKENS;
  }

  /**
   * Check if compression is safe (no incomplete tool calls at the end).
   */
  isCompressionSafe(sessionKey) {
    const state = this.sessions.get(sessionKey);
    if (!state) return true;
    const lastEntry = state.rawBuffer.at(-1);
    return !lastEntry || lastEntry.isComplete;
  }

  /**
   * Trigger AI compression of raw events into a brief.
   * Rolling update: new_brief = AI(old_brief + new_raw_events)
   */
  async triggerCompression(sessionKey, trigger) {
    const state = this.sessions.get(sessionKey);
    if (!state) return;
    if (state.compressionInProgress) return;
    state.compressionInProgress = true;

    try {
      const newEvents = state.rawBuffer.filter(e => e.seq > state.lastCompressedSeq && e.isComplete);
      if (newEvents.length === 0) {
        state.compressionInProgress = false;
        return;
      }

      const serialized = this._serializeForLLM(newEvents);
      const priorBrief = state.currentBrief || '(first compression — no prior brief)';

      console.log(`[SecurityMemory] Compressing ${newEvents.length} events (${trigger}) for ${sessionKey}`);

      let newBrief;
      if (this.cloudJudge?.isConfigured) {
        const userMessage = `[PRIOR BRIEF]\n${priorBrief}\n\n[NEW EVENTS (${newEvents.length} tool calls)]\n${serialized}`;
        const result = await this.cloudJudge._callProvider(userMessage, COMPRESSION_SYSTEM_PROMPT);
        // Handle {text, thinking} response from Claude extended thinking
        newBrief = typeof result === 'object' && result.text ? result.text : result;
      } else {
        // Fallback to rule-based
        newBrief = _fallbackBrief(state, this.sessionSignals, this.eventStore, sessionKey);
      }

      if (newBrief && newBrief.length > 50) {
        state.currentBrief = newBrief;
        state.lastCompressedSeq = newEvents.at(-1).seq;
        state.compressionCount++;
        state.pendingDelivery = newBrief;

        // Trim old raw events, keep last RAW_KEEPALIVE
        const keepFrom = state.lastCompressedSeq - RAW_KEEPALIVE;
        state.rawBuffer = state.rawBuffer.filter(e => e.seq > keepFrom);

        console.log(`[SecurityMemory] Brief generated (${trigger}): ${newBrief.length} chars, compression #${state.compressionCount}`);
      }
    } catch (e) {
      console.error(`[SecurityMemory] Compression failed: ${e.message}`);
    } finally {
      state.compressionInProgress = false;
    }
  }

  /**
   * Get the current brief for a session (for cloud judge injection).
   */
  getCurrentBrief(sessionKey) {
    return this.sessions.get(sessionKey)?.currentBrief || null;
  }

  /**
   * Get brief formatted for cloud judge prompt injection.
   * Truncates if over BRIEF_MAX_TOKENS.
   */
  getBriefForJudge(sessionKey) {
    const brief = this.getCurrentBrief(sessionKey);
    if (!brief) return null;
    const tokens = countTokens(brief);
    if (tokens <= BRIEF_MAX_TOKENS) return brief;
    // Truncate: try to keep Risk Summary section
    const riskIdx = brief.indexOf('## Risk Summary');
    if (riskIdx > 0) {
      const riskSection = brief.slice(riskIdx);
      const prefix = brief.slice(0, BRIEF_MAX_TOKENS * 3).trimEnd(); // rough char estimate
      return `${prefix}\n...[truncated]\n${riskSection}`;
    }
    return brief.slice(0, BRIEF_MAX_TOKENS * 4) + '\n...[truncated]';
  }

  // ─── Delivery ───────────────────────────────────────────────────────────

  /**
   * Consume pending brief for delivery to agent (via next PreToolUse systemMessage).
   */
  consumeBrief(sessionKey) {
    const state = this.sessions.get(sessionKey);
    if (!state?.pendingDelivery) return null;
    const brief = state.pendingDelivery;
    state.pendingDelivery = null;
    return brief;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  cleanup(sessionKey) {
    this.sessions.delete(sessionKey);
  }

  getStats(sessionKey) {
    const state = this.sessions.get(sessionKey);
    if (!state) return { rawEvents: 0, bufferTokens: 0, compressionCount: 0, briefTokens: 0 };
    return {
      rawEvents: state.rawBuffer.length,
      bufferTokens: this.getBufferTokenCount(sessionKey),
      compressionCount: state.compressionCount,
      briefTokens: state.currentBrief ? countTokens(state.currentBrief) : 0,
    };
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  _getState(sessionKey) {
    if (!this.sessions.has(sessionKey)) {
      this.sessions.set(sessionKey, {
        rawBuffer: [],
        nextSeq: 0,
        currentBrief: null,
        lastCompressedSeq: -1,
        compressionCount: 0,
        compressionInProgress: false,
        compressionPending: false,
        pendingDelivery: null,
      });
      this._evictOldest();
    }
    return this.sessions.get(sessionKey);
  }

  _evictOldest() {
    if (this.sessions.size <= MAX_SESSIONS) return;
    let oldestKey = null, oldestTime = Infinity;
    for (const [key, state] of this.sessions) {
      const lastTime = state.rawBuffer.at(-1)?.timestamp || 0;
      if (lastTime < oldestTime) {
        oldestTime = lastTime;
        oldestKey = key;
      }
    }
    if (oldestKey) this.sessions.delete(oldestKey);
  }

  _serializeForLLM(events) {
    return events.map(e => {
      const parts = [`[${e.seq}] ${new Date(e.timestamp).toISOString()} ${e.toolName}`];
      parts.push(`  input: ${e.paramsDigest}`);
      if (e.resultDigest) parts.push(`  output: ${e.resultDigest}`);
      parts.push(`  score: ${e.riskScore} verdict: ${e.verdict} allowed: ${e.allowed}`);
      if (e.flags.length > 0) parts.push(`  flags: ${e.flags.join(', ')}`);
      if (e.dataFlowTag) parts.push(`  flow: ${e.dataFlowTag}`);
      return parts.join('\n');
    }).join('\n\n');
  }
}

// Export helpers for use in index.js
export { buildParamsDigest, buildDataFlowTag };
