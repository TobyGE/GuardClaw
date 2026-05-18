// Security Context — project-specific security knowledge learned from sessions.
// Stored as a markdown file (~/.guardclaw/security-context.md) and loaded into
// the judge prompt as additional context.
//
// Updated at session end: LLM summarizes tool call patterns into rules.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { updateGlobalKnowledge } from './global-knowledge.js';

const CONTEXT_DIR = path.join(os.homedir(), '.guardclaw');
const CONTEXT_FILE = path.join(CONTEXT_DIR, 'security-context.md');
const MAX_CONTEXT_SIZE = 10000; // chars, ~2.5K tokens

// ─── Read / Write ──────────────────────────────────────────────────────────

export function loadSecurityContext() {
  try {
    const content = fs.readFileSync(CONTEXT_FILE, 'utf8');
    // Truncate if too large
    return content.length > MAX_CONTEXT_SIZE
      ? content.slice(0, MAX_CONTEXT_SIZE) + '\n...[truncated]'
      : content;
  } catch {
    return null;
  }
}

export function saveSecurityContext(content) {
  try {
    fs.mkdirSync(CONTEXT_DIR, { recursive: true });
    fs.writeFileSync(CONTEXT_FILE, content, 'utf8');
    console.log(`[SecurityContext] Updated ${CONTEXT_FILE} (${content.length} chars)`);
  } catch (e) {
    console.error(`[SecurityContext] Failed to save: ${e.message}`);
  }
}

// ─── Summarize session into context rules ──────────────────────────────────

const SUMMARIZE_PROMPT = `You are a security analyst reviewing an AI coding agent's session. You will receive:
1. The current security-context.md (may be empty)
2. A list of tool calls from this session with their risk scores and outcomes

Your job: update the security-context.md with lessons learned from this session.

Rules:
- Identify SAFE BASELINE patterns (operations that were consistently safe, score 1-3)
- Identify TRUSTED domains/services the project uses
- USER DECISIONS: only record approve/deny when the event explicitly carries the
  label [USER-APPROVED] or [USER-DENIED]. Do NOT infer "user prefers X" from
  patterns of repeated high-risk gating, score distributions, or absence of an
  approval — those are agent-side judgments, not user preferences. If the user
  hasn't explicitly approved or denied a pattern, leave that pattern out of
  this section entirely.
- Note any RISKS observed (high scores, suspicious patterns)
- Keep entries concise — one line per rule
- Merge with existing content, don't duplicate
- Remove stale entries that conflict with new observations
- Total output should be under 4000 characters

Output ONLY the updated markdown content (no explanation, no code fences).
Use this structure:

# Security Context

## Project
- basic project info

## Safe Baseline
- patterns that are always safe

## Trusted Domains
- domains the project legitimately uses

## User Decisions
- what the user has approved/denied

## Known Risks
- patterns to watch out for`;

/**
 * Summarize a session and update security-context.md.
 * Called at session end (stop hook).
 *
 * @param {string|Array} briefOrEvents - Level 1 AI brief (string) or raw events (Array, fallback)
 * @param {object} cloudJudge - CloudJudge instance for LLM call
 * @param {object} sessionSignals - signals for this session
 */
export async function summarizeSession(briefOrEvents, cloudJudge, sessionSignals) {
  if (!briefOrEvents) return;
  if (!cloudJudge?.isConfigured) return;

  const currentContext = loadSecurityContext() || '(empty — first session)';
  let sessionContent;

  if (typeof briefOrEvents === 'string') {
    // Level 1 brief (preferred path)
    sessionContent = `Session security brief (AI-generated):\n${briefOrEvents}`;
  } else if (Array.isArray(briefOrEvents)) {
    // Fallback: raw events array.
    // Drop verdict='expired' (timeout-inferred, not a real user decision) — those
    // would otherwise show up as [DENIED] and get encoded into security-context.md
    // as "user prefers X" by the cloud judge, poisoning every future session.
    const cleaned = briefOrEvents.filter(e => e.safeguard?.verdict !== 'expired');
    if (cleaned.length < 3) return;
    const eventSummary = cleaned.slice(-100).map(e => {
      const tool = e.toolName || e.tool || '?';
      const score = e.safeguard?.riskScore ?? e.riskScore ?? '?';
      const v = e.safeguard?.verdict || (score >= 8 ? 'BLOCK' : score >= 4 ? 'WARNING' : 'SAFE');
      const desc = (e.description || e.command || '').slice(0, 120);
      // Only label as [DENIED] for real user denials. Other allowed=false rows
      // (expired filtered above, pass-through, etc.) just show no label.
      const label = v === 'user-denied' ? ' [USER-DENIED]'
        : v === 'user-approved' ? ' [USER-APPROVED]'
        : '';
      return `- [${v} ${score}] ${tool}: ${desc}${label}`;
    }).join('\n');
    sessionContent = `Session tool calls (${cleaned.length} total, ${briefOrEvents.length - cleaned.length} expired-pending dropped):\n${eventSummary}`;
  } else {
    return;
  }

  // Add session signals summary
  let signalsSummary = '';
  if (sessionSignals) {
    const parts = [];
    if (sessionSignals.sensitiveDataAccessed) parts.push(`Sensitive files accessed: ${sessionSignals.sensitiveFiles.join(', ')}`);
    if (sessionSignals.networkUsed) parts.push('Network tools used');
    if (sessionSignals.destructiveActionTaken) parts.push('Destructive actions taken');
    parts.push(`Total tool calls: ${sessionSignals.toolCount}, high-risk: ${sessionSignals.highRiskCount}`);
    signalsSummary = `\nSession signals: ${parts.join('; ')}`;
  }

  const userMessage = `Current security-context.md:
---
${currentContext}
---

${sessionContent}
${signalsSummary}

Update the security-context.md based on this session.`;

  try {
    // Use cloud judge's provider to make the LLM call
    const text = await cloudJudge._callProvider(
      userMessage,
      SUMMARIZE_PROMPT // override system prompt
    );

    if (!text || text.length < 50) {
      console.log('[SecurityContext] LLM returned insufficient content, skipping update');
      return;
    }

    // Clean up response
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```markdown\s*/i, '').replace(/\s*```$/, '');
    if (!cleaned.startsWith('#')) {
      // Try to find the markdown start
      const idx = cleaned.indexOf('# Security Context');
      if (idx >= 0) cleaned = cleaned.slice(idx);
    }

    saveSecurityContext(cleaned);

    // Promote high-severity findings to global knowledge (Level 3)
    if (typeof briefOrEvents === 'string') {
      updateGlobalKnowledge(briefOrEvents, cloudJudge).catch(e => {
        console.error(`[SecurityContext] Global knowledge update failed: ${e.message}`);
      });
    }
  } catch (e) {
    console.error(`[SecurityContext] Summarization failed: ${e.message}`);
  }
}
