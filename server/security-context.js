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
- Note any USER DECISIONS (approve/deny) and what they imply
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
    // Fallback: raw events array
    if (briefOrEvents.length < 3) return;
    const eventSummary = briefOrEvents.slice(-100).map(e => {
      const tool = e.toolName || e.tool || '?';
      const score = e.safeguard?.riskScore ?? e.riskScore ?? '?';
      const verdict = e.safeguard?.verdict || (score >= 8 ? 'BLOCK' : score >= 4 ? 'WARNING' : 'SAFE');
      const desc = (e.description || e.command || '').slice(0, 120);
      const approved = e.safeguard?.allowed === true ? '' : e.safeguard?.allowed === false ? ' [DENIED]' : ' [USER-APPROVED]';
      return `- [${verdict} ${score}] ${tool}: ${desc}${approved}`;
    }).join('\n');
    sessionContent = `Session tool calls (${briefOrEvents.length} total):\n${eventSummary}`;
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
