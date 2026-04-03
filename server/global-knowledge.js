// Global Knowledge — Level 3 of the security memory hierarchy.
// Cross-project security knowledge persisted at ~/.guardclaw/global-knowledge.md.
// Updated when sessions contain high-severity findings that are project-independent.

import fs from 'fs';
import path from 'path';
import os from 'os';

const KNOWLEDGE_DIR = path.join(os.homedir(), '.guardclaw');
const KNOWLEDGE_FILE = path.join(KNOWLEDGE_DIR, 'global-knowledge.md');
const MAX_SIZE = 8000; // chars, ~2K tokens

export function loadGlobalKnowledge() {
  try {
    const content = fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
    return content.length > MAX_SIZE
      ? content.slice(0, MAX_SIZE) + '\n...[truncated]'
      : content;
  } catch {
    return null;
  }
}

export function saveGlobalKnowledge(content) {
  try {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    fs.writeFileSync(KNOWLEDGE_FILE, content, 'utf8');
    console.log(`[GlobalKnowledge] Updated ${KNOWLEDGE_FILE} (${content.length} chars)`);
  } catch (e) {
    console.error(`[GlobalKnowledge] Failed to save: ${e.message}`);
  }
}

const UPDATE_PROMPT = `You are a security analyst. You will receive:
1. The current global-knowledge.md (cross-project security knowledge)
2. A session security brief that may contain project-independent findings

Your job: decide if any findings should be promoted to global knowledge.

Only promote findings that are UNIVERSALLY relevant across projects:
- Dangerous MCP servers or skills (prompt injection, data exfiltration)
- Suspicious external domains used in exfiltration
- Known attack patterns (multi-step sequences, obfuscation techniques)
- Cross-project trusted baselines

Do NOT promote:
- Project-specific file paths or configurations
- Legitimate tools used normally in one project
- Low-confidence anomalies

Output the updated global-knowledge.md content. If nothing to add, output the existing content unchanged.
Keep under 7000 characters. Use this structure:

# Global Security Knowledge

## Dangerous MCP Servers
- server: reason, first_seen

## Suspicious Domains
- domain: reason, first_seen

## Known Attack Patterns
- pattern description, confidence

## Trusted Baselines
- patterns confirmed safe across projects`;

/**
 * Check if a session brief contains findings worth promoting to global knowledge.
 * @param {string} sessionBrief - Level 1 AI-generated brief
 * @param {object} cloudJudge - CloudJudge instance
 */
export async function updateGlobalKnowledge(sessionBrief, cloudJudge) {
  if (!sessionBrief || !cloudJudge?.isConfigured) return;

  // Only run if brief contains high-severity signals
  const hasHighSeverity = /BLOCK|exfiltration|injection|malicious|compromised|poisoned/i.test(sessionBrief);
  if (!hasHighSeverity) return;

  const current = loadGlobalKnowledge() || '(empty — no global knowledge yet)';

  try {
    const text = await cloudJudge._callProvider(
      `Current global-knowledge.md:\n---\n${current}\n---\n\nSession brief:\n---\n${sessionBrief}\n---\n\nUpdate the global knowledge if any findings are universally relevant.`,
      UPDATE_PROMPT
    );

    if (!text || text.length < 30) return;

    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```markdown\s*/i, '').replace(/\s*```$/, '');
    if (!cleaned.startsWith('#')) {
      const idx = cleaned.indexOf('# Global Security Knowledge');
      if (idx >= 0) cleaned = cleaned.slice(idx);
    }

    saveGlobalKnowledge(cleaned);
  } catch (e) {
    console.error(`[GlobalKnowledge] Update failed: ${e.message}`);
  }
}
