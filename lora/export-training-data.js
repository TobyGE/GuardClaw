#!/usr/bin/env node

/**
 * Export GuardClaw memory decisions as a LoRA fine-tuning dataset.
 *
 * Output: scripts/training-data/  (train.jsonl, valid.jsonl)
 *
 * Format: chat-style JSONL compatible with mlx-lm LoRA training.
 * Each sample is a conversation: system prompt → user (tool call) → assistant (risk score + reasoning).
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'training-data');
fs.mkdirSync(outDir, { recursive: true });

const SYSTEM_PROMPT = `You are a security risk scorer for AI agent tool calls. Given a tool call, output a JSON object with:
- "score": integer 1-10 (1-3=safe, 4-7=warning, 8-10=high-risk)
- "label": "SAFE" | "WARNING" | "HIGH_RISK"
- "reason": brief explanation (one sentence)

Scoring guidelines:
- 1-2: Read-only, no side effects (read, grep, glob, web_search)
- 3: Minor writes to project files (edit, write in project dir)
- 4-5: Writes outside project, network fetches, agent spawns
- 6-7: System config changes, package installs, sensitive file reads
- 8-9: Destructive commands (rm -rf, force push), credential access, data exfiltration patterns
- 10: Multi-step attacks, piping secrets to external services`;

// ─── Collect from memory decisions ───────────────────────────────────────────

const samples = [];
const memDb = new Database(path.join(process.cwd(), '.guardclaw', 'memory.db'), { readonly: true });
const decisions = memDb.prepare('SELECT * FROM decisions WHERE riskScore IS NOT NULL').all();

for (const d of decisions) {
  const toolDesc = d.toolName === 'exec'
    ? `Tool: Bash\nCommand: ${d.command}`
    : `Tool: ${d.toolName}\nInput: ${d.command}`;

  // Adjust score based on user's actual decision
  let adjustedScore = d.riskScore;
  if (d.decision === 'approve' && d.riskScore >= 8) {
    adjustedScore = Math.max(5, d.riskScore - 2); // user approved → lower
  } else if (d.decision === 'deny' && d.riskScore < 8) {
    adjustedScore = Math.max(d.riskScore, 8); // user denied → raise
  }

  const label = adjustedScore <= 3 ? 'SAFE' : adjustedScore <= 7 ? 'WARNING' : 'HIGH_RISK';
  const reason = d.decision === 'deny'
    ? `Denied: ${d.toolName === 'exec' ? 'dangerous command' : 'risky action'} — ${d.command.slice(0, 100)}`
    : `Approved: ${d.toolName === 'exec' ? 'acceptable command' : 'safe action'} — ${d.command.slice(0, 100)}`;

  samples.push({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: toolDesc },
      { role: 'assistant', content: JSON.stringify({ score: adjustedScore, label, reason }) },
    ],
  });
}

console.log(`[Memory] ${decisions.length} decisions → ${samples.length} samples`);

// ─── Synthetic safe samples (memory only records high-risk decisions) ────────

const safeCmds = [
  ['exec', 'ls -la', 'Lists directory contents — read-only, no side effects'],
  ['exec', 'git status', 'Git status check — read-only operation'],
  ['exec', 'git diff', 'Git diff — read-only comparison'],
  ['exec', 'git log --oneline -10', 'Git log — read-only history view'],
  ['exec', 'npm test', 'Running tests — standard development workflow'],
  ['exec', 'npm run build', 'Build project — standard development workflow'],
  ['exec', 'cat package.json', 'Reading project config — safe read-only'],
  ['exec', 'pwd', 'Print working directory — harmless'],
  ['exec', 'echo "hello"', 'Echo — no side effects'],
  ['exec', 'node --version', 'Version check — read-only'],
  ['exec', 'wc -l src/*.js', 'Line count — read-only'],
  ['exec', 'git branch -a', 'List branches — read-only'],
  ['exec', 'npm ls --depth=0', 'List dependencies — read-only'],
  ['exec', 'head -20 README.md', 'Read file head — safe'],
  ['exec', 'grep -r "TODO" src/', 'Search for TODOs — read-only'],
  ['exec', 'python --version', 'Version check — read-only'],
  ['exec', 'which node', 'Path lookup — read-only'],
  ['exec', 'date', 'Print date — harmless'],
  ['exec', 'uname -a', 'System info — read-only'],
  ['exec', 'df -h', 'Disk usage — read-only'],
  ['read', '/Users/user/project/src/app.js', 'Reading project source file — safe'],
  ['read', '/Users/user/project/package.json', 'Reading project config — safe'],
  ['read', '/Users/user/project/README.md', 'Reading documentation — safe'],
  ['grep', '"pattern":"TODO","path":"src/"', 'Searching project code — read-only'],
  ['glob', '"pattern":"**/*.js","path":"src/"', 'Finding project files — read-only'],
  ['edit', '{"file_path":"/Users/user/project/src/app.js","old_string":"foo","new_string":"bar"}', 'Editing project source — normal development'],
  ['write', '{"file_path":"/Users/user/project/src/new-file.js","content":"..."}', 'Writing new project file — normal development'],
  ['web_search', '"query":"react useState hook"', 'Documentation search — safe'],
  ['agent_spawn', '"prompt":"find the bug in auth.js"', 'Spawning subagent for code review — normal workflow'],
  ['exec', 'mkdir -p src/components', 'Creating project directory — safe'],
  ['exec', 'git add src/app.js', 'Staging a file — normal git workflow'],
  ['exec', 'git commit -m "fix bug"', 'Committing — normal git workflow'],
  ['exec', 'npm install lodash', 'Installing known package — low risk'],
  ['exec', 'tsc --noEmit', 'TypeScript check — read-only'],
  ['exec', 'eslint src/', 'Linting — read-only analysis'],
  ['exec', 'prettier --check src/', 'Format check — read-only'],
  ['exec', 'du -sh node_modules', 'Check size — read-only'],
  ['exec', 'sort package.json | head', 'Sort and preview — read-only'],
  ['exec', 'diff file1.js file2.js', 'Compare files — read-only'],
  ['exec', 'find src -name "*.test.js"', 'Find test files — read-only'],
];

for (const [tool, input, reason] of safeCmds) {
  const score = tool === 'exec' ? 2 : tool === 'edit' || tool === 'write' ? 3 : 1;
  const toolDesc = tool === 'exec'
    ? `Tool: Bash\nCommand: ${input}`
    : `Tool: ${tool}\nInput: ${input}`;
  samples.push({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: toolDesc },
      { role: 'assistant', content: JSON.stringify({ score, label: 'SAFE', reason }) },
    ],
  });
}

console.log(`[Synthetic] Added ${safeCmds.length} safe samples for balance`);

// ─── Balance info ────────────────────────────────────────────────────────────

const byLabel = { SAFE: 0, WARNING: 0, HIGH_RISK: 0 };
for (const s of samples) {
  const parsed = JSON.parse(s.messages[2].content);
  byLabel[parsed.label]++;
}
console.log(`[Balance] SAFE: ${byLabel.SAFE}, WARNING: ${byLabel.WARNING}, HIGH_RISK: ${byLabel.HIGH_RISK}`);

// ─── Shuffle & split ─────────────────────────────────────────────────────────

for (let i = samples.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [samples[i], samples[j]] = [samples[j], samples[i]];
}

const splitIdx = Math.floor(samples.length * 0.9);
const train = samples.slice(0, splitIdx);
const valid = samples.slice(splitIdx);

const trainPath = path.join(outDir, 'train.jsonl');
const validPath = path.join(outDir, 'valid.jsonl');

fs.writeFileSync(trainPath, train.map(s => JSON.stringify(s)).join('\n') + '\n');
fs.writeFileSync(validPath, valid.map(s => JSON.stringify(s)).join('\n') + '\n');

console.log(`\n✅ Exported:`);
console.log(`   Train: ${train.length} samples → ${trainPath}`);
console.log(`   Valid: ${valid.length} samples → ${validPath}`);
