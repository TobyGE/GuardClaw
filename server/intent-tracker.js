// Intent Tracker — classifies user intent via LLM and detects
// when tool calls deviate from the stated intent.
//
// Primary: LLM classification (language-agnostic, handles any language)
// Fallback: regex-based classification (English only, when LLM unavailable)

// ─── Tool expectations per intent category ──────────────────────────────────

const CATEGORY_TOOLS = {
  'code-write': {
    label: 'Writing / editing code',
    expectedTools: new Set(['write', 'edit', 'read', 'glob', 'grep', 'exec', 'agent_spawn', 'skill', 'web_search', 'tool_search']),
    suspiciousTools: new Set(['web_fetch']),
  },
  'code-read': {
    label: 'Reading / understanding code',
    expectedTools: new Set(['read', 'glob', 'grep', 'exec', 'web_search', 'tool_search']),
    suspiciousTools: new Set(['write', 'edit', 'web_fetch']),
  },
  'test': {
    label: 'Testing',
    expectedTools: new Set(['read', 'write', 'edit', 'glob', 'grep', 'exec', 'agent_spawn', 'skill']),
    suspiciousTools: new Set(['web_fetch']),
  },
  'git': {
    label: 'Git / version control',
    expectedTools: new Set(['exec', 'read', 'glob', 'grep', 'write', 'edit']),
    suspiciousTools: new Set(['web_fetch']),
  },
  'deploy': {
    label: 'Deployment / ops',
    expectedTools: new Set(['exec', 'read', 'write', 'edit', 'glob', 'grep', 'web_fetch', 'web_search']),
    suspiciousTools: new Set([]),
  },
  'research': {
    label: 'Research / learning',
    expectedTools: new Set(['read', 'glob', 'grep', 'exec', 'web_search', 'web_fetch', 'agent_spawn', 'tool_search']),
    suspiciousTools: new Set([]),
  },
  'config': {
    label: 'Configuration / setup',
    expectedTools: new Set(['exec', 'read', 'write', 'edit', 'glob', 'grep', 'web_search', 'web_fetch']),
    suspiciousTools: new Set([]),
  },
};

// ─── LLM-based intent classification ────────────────────────────────────────

const INTENT_SYSTEM_PROMPT = `You are a security-focused intent classifier for an AI coding agent safety monitor.

You will receive the user's latest message AND session context (previous messages + tool calls). Classify the user's CURRENT intent based on ALL available context.

Reply with ONLY a JSON object (no markdown, no explanation):
{
  "categories": ["code-write", "test"],
  "explicit_sensitive": false,
  "summary": "writing unit tests for auth module"
}

Categories (pick 1-3 that apply):
- code-write: writing, creating, editing, fixing, refactoring code
- code-read: reading, explaining, reviewing, debugging, understanding code
- test: running or writing tests
- git: git operations (commit, push, merge, branch, PR)
- deploy: deployment, publishing, Docker, CI/CD
- research: researching, learning, exploring, comparing
- config: configuration, setup, installation

explicit_sensitive: true ONLY if the user explicitly asks to handle credentials, SSH keys, secrets, .env files, sudo, delete/destroy operations, or network transfers.

summary: one-line description of what the user actually wants (e.g. "writing unit tests for auth module", "deploying to staging server"). This helps detect deviation later.

IMPORTANT:
- Short messages like "ok", "yes", "continue", "好" should inherit intent from context
- If context shows the user was writing tests, and they say "ok push it", the intent is now "git" (not "test")
- Always consider the FULL conversation flow, not just the latest message`;

/**
 * Classify intent using the safeguard service's LLM.
 * Falls back to regex if LLM is unavailable.
 *
 * @param {string} promptText - user prompt
 * @param {object} safeguardService - the SafeguardService instance (for LLM access)
 * @param {string|null} sessionContext - formatted session context (prompts + tools timeline)
 * @returns {Promise<object>} intent classification
 */
export async function classifyIntent(promptText, safeguardService = null, sessionContext = null) {
  if (!promptText || typeof promptText !== 'string') {
    return { categories: [], explicitSensitive: false, raw: '' };
  }

  const text = promptText.trim().slice(0, 500);

  // Try LLM classification first
  if (safeguardService?.enabled && safeguardService?.llm) {
    try {
      const result = await classifyWithLLM(text, safeguardService, sessionContext);
      if (result) return result;
    } catch (e) {
      console.log(`[IntentTracker] LLM classification failed, using fallback: ${e.message}`);
    }
  }

  // Fallback to regex
  return classifyWithRegex(text);
}

async function classifyWithLLM(text, safeguardService, sessionContext) {
  const llm = safeguardService.llm;
  if (!llm) return null;

  const model = safeguardService.config?.lmstudioModel ||
                safeguardService.config?.ollamaModel ||
                safeguardService.config?.model ||
                'auto';

  // Build user message with context
  let userMessage = '';
  if (sessionContext) {
    userMessage += `Session context:\n${sessionContext}\n\n`;
  }
  userMessage += `Current user message:\n${text}`;

  const response = await llm.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: INTENT_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.1,
    max_tokens: 200,
  });

  const raw = response?.choices?.[0]?.message?.content?.trim();
  if (!raw) return null;

  // Parse JSON — handle potential markdown wrapping
  const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(jsonStr);

  if (!parsed.categories || !Array.isArray(parsed.categories)) return null;

  // Map to our format with tool expectations
  const categories = parsed.categories
    .filter(id => CATEGORY_TOOLS[id])
    .map(id => ({
      id,
      label: CATEGORY_TOOLS[id].label,
      expectedTools: CATEGORY_TOOLS[id].expectedTools,
      suspiciousTools: CATEGORY_TOOLS[id].suspiciousTools,
    }));

  return {
    categories,
    explicitSensitive: !!parsed.explicit_sensitive,
    summary: parsed.summary || '',
    raw: text,
    source: 'llm',
  };
}

// ─── Regex fallback (English only) ──────────────────────────────────────────

const REGEX_CATEGORIES = [
  { id: 'code-write', re: /\b(write|create|add|implement|build|make|generate|develop|refactor|rewrite|fix|patch|update|change|modify|rename|move)\b/i },
  { id: 'code-read', re: /\b(read|explain|understand|look\s*at|check|review|show|find|search|debug|diagnose|investigate|trace)\b/i },
  { id: 'test', re: /\b(test|spec|coverage|run\s+(the\s+)?(unit\s+)?tests?|write\s+tests?|add\s+(a\s+)?tests?|e2e)\b/i },
  { id: 'git', re: /\b(commit|push|pull|merge|rebase|branch|checkout|stash|diff|log|blame|tag|release|pr|pull\s*request)\b/i },
  { id: 'deploy', re: /\b(deploy|ship|release|publish|docker|k8s|kubernetes|terraform|ci\/cd|pipeline)\b/i },
  { id: 'research', re: /\b(research|learn|explore|compare|evaluate|benchmark|analyze|study|look\s+into)\b/i },
  { id: 'config', re: /\b(config|configure|setup|set\s*up|install|init|initialize|bootstrap|scaffold)\b/i },
];

const REGEX_SENSITIVE = [
  /\b(ssh|credential|key|secret|token|password|\.env)\b/i,
  /\b(curl|wget|fetch|download|upload|send|post)\b.*\b(to|from)\b/i,
  /\bsudo\b/i,
  /\b(delete|remove|drop|destroy|wipe|clean)\b/i,
];

function classifyWithRegex(text) {
  const matched = [];
  for (const { id, re } of REGEX_CATEGORIES) {
    if (re.test(text) && CATEGORY_TOOLS[id]) {
      matched.push({
        id,
        label: CATEGORY_TOOLS[id].label,
        expectedTools: CATEGORY_TOOLS[id].expectedTools,
        suspiciousTools: CATEGORY_TOOLS[id].suspiciousTools,
      });
    }
  }

  const explicitSensitive = REGEX_SENSITIVE.some(re => re.test(text));

  return {
    categories: matched,
    explicitSensitive,
    raw: text.slice(0, 500),
    source: 'regex',
  };
}

// ─── Deviation detection ────────────────────────────────────────────────────

/**
 * Check if a tool call deviates from the user's stated intent.
 */
export function checkDeviation(toolName, params, intent) {
  if (!intent || intent.categories.length === 0) {
    return { deviated: false, severity: 0, reason: '' };
  }

  if (intent.explicitSensitive) {
    return { deviated: false, severity: 0, reason: 'User explicitly mentioned sensitive operations' };
  }

  const tool = toolName.toLowerCase();

  const anyExpected = intent.categories.some(c => c.expectedTools.has(tool));
  const anySuspicious = intent.categories.some(c => c.suspiciousTools.has(tool));

  if (anyExpected) {
    return { deviated: false, severity: 0, reason: '' };
  }

  if (anySuspicious) {
    const matchedCat = intent.categories.find(c => c.suspiciousTools.has(tool));
    const reason = `Tool "${toolName}" is suspicious for intent "${matchedCat.label}" (user said: "${intent.raw.slice(0, 80)}")`;
    return { deviated: true, severity: 2, reason };
  }

  const catLabels = intent.categories.map(c => c.label).join(', ');
  return {
    deviated: true,
    severity: 1,
    reason: `Tool "${toolName}" is unexpected for intent [${catLabels}]`,
  };
}

/**
 * Compute a risk floor adjustment based on intent deviation.
 */
export function deviationFloorBoost(toolName, params, intent, sessionSignals) {
  const { deviated, severity } = checkDeviation(toolName, params, intent);

  if (!deviated) return 0;

  if (severity >= 2 && sessionSignals?.sensitiveDataAccessed) return 3;
  if (severity >= 2) return 2;
  if (severity >= 1 && sessionSignals?.sensitiveDataAccessed) return 1;

  return 0;
}
