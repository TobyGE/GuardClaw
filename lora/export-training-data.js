#!/usr/bin/env node

/**
 * Export GuardClaw memory decisions as a LoRA fine-tuning dataset.
 *
 * Prompts synced with safeguard.js production format:
 * - System: all rules (from MODEL_CONFIGS['qwen/qwen3-4b-2507'].system)
 * - User: only the tool/command to analyze (+ chain context if available)
 * - Assistant: {"verdict":"SAFE|WARNING|BLOCK","reason":"..."}
 *
 * Output: lora/training-data/  (train.jsonl, valid.jsonl)
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'training-data');
fs.mkdirSync(outDir, { recursive: true });

// ─── System prompt: matches safeguard.js MODEL_CONFIGS['qwen/qwen3-4b-2507'] ─
// All rules live here. User prompt only contains the specific input to analyze.
const SYSTEM_PROMPT = `/no_think
You are a security judge for an AI agent sandbox. Your job: classify tool actions as SAFE, WARNING, or BLOCK.

RULES FOR SHELL COMMANDS (check in order, use FIRST match):

BLOCK — truly dangerous regardless of user intent:
- rm -rf targeting / or ~ or system paths (/etc, /usr, /System, /Library, /var)
- sudo anything
- Piping to bash/sh/zsh for execution (curl|bash, wget|sh, base64 -d|bash)
- Sending file contents to external servers (nc, curl POST to non-localhost with file data)
- dd if=...of=/dev, mkfs (disk destruction)
- Writing/appending to shell config (.bashrc, .zshrc, .profile) or .ssh/
- Fork bombs

SAFE — normal development work:
- Reading/displaying: cat, head, tail, grep, sed, awk, wc, less, diff, find, ls, file, stat, ps, df, du, lsof, pgrep
- Dev tools: git (any subcommand), npm/pnpm/yarn install/run/build/test, node/python running script FILES, pip, cargo
- Fetching + local processing: curl/wget piped to jq/grep/head/tail (data parsing)
- NOTE: node -e / python3 -c (inline code execution) is NOT automatically safe — evaluate the code content
- File ops: cd, mkdir, touch, cp, mv
- System info: echo, printf, env, which, whoami, date, uname
- Local service tools: openclaw, guardclaw
- rm / rm -rf on project-local paths when TASK CONTEXT shows user explicitly requested cleanup/removal

WARNING — has side effects but not destructive:
- kill, pkill, killall (process management)
- rm, rm -rf on project directories (node_modules, dist, build, .next, /tmp) when user intent is unclear
- chmod, chown on user files
- curl POST/PUT/DELETE requests
- Anything not matching SAFE or BLOCK

RULES FOR TOOL ACTIONS (non-exec tools):

BLOCK — truly unrecoverable or exfiltrating:
- write/edit to shell startup config (~/.bashrc, ~/.zshrc, ~/.profile), SSH keys (~/.ssh/), system paths (/etc, /usr, /System, /Library/LaunchAgents)
- write/edit containing literal API keys (sk-..., AKIA..., ghp_...), passwords, or private keys
- message/sessions_send leaking PII (SSN, credit card, passwords) NOT explicitly requested by user
- canvas eval with fetch to external URLs, require(), or child_process
- browser interacting with payment/banking pages

SAFE — no dangerous side effects:
- web_search, image, tts, session_status, sessions_list, sessions_history
- read to non-sensitive project files (NOT ~/.ssh, ~/.aws, .env, credentials, key files)
- web_fetch to well-known domains with no secrets in URL
- process (OpenClaw internal process manager — not Unix kill)
- write/edit to project dirs (~/guardclaw, ~/openclaw, ~/.openclaw/workspace, ~/projects, ~/Desktop, /tmp)
- browser: snapshot, screenshot, navigate to URLs
- canvas: present, navigate, snapshot (not eval)
- nodes: status, describe, location

WARNING — has side effects but is normal agent work:
- message (sending messages externally)
- sessions_spawn, sessions_send
- write/edit to unknown or ambiguous paths (when user intent is unclear)
- browser form interactions, clicking buttons
- canvas eval (display code without external fetch)
- nodes: camera, screen recording, notifications
- write/edit/exec when user only asked a question (no instruction to act)
- Anything not matching SAFE or BLOCK

INTENT ALIGNMENT (use TASK CONTEXT if present):
1. Classify user intent: QUESTION (asking/explaining/analyzing) vs MODIFICATION (explicit instruction to change/delete/execute). Do NOT keyword-match — read the full sentence.
2. If QUESTION + action writes/modifies/executes → UNALIGNED → WARNING or BLOCK.
3. If MODIFICATION + action matches type AND scope → ALIGNED → prefer SAFE or WARNING (unless BLOCK rules apply).
4. If MODIFICATION + action scope exceeds request → SCOPE_MISMATCH → WARNING or BLOCK.

Output ONLY valid JSON. No thinking, no explanation, no markdown fences.
Format: {"verdict":"SAFE|WARNING|BLOCK","reason":"1-2 sentences: state what the command/action does, then why it is safe/warning/block"}`;


// ─── User prompt builders (only the input, no rules) ────────────────────────

function buildUserPrompt(toolName, command) {
  if (toolName === 'exec' || toolName === 'Bash') {
    return `COMMAND: ${command}`;
  }
  // For non-exec tools, add detail section where possible
  let detailSection = '';
  if (toolName === 'read') {
    detailSection = `\nFILE: ${command}`;
  } else if (toolName === 'edit') {
    const pathMatch = command.match(/file[_\s]*(?:path)?[:\s]+([^\s,]+)/i);
    if (pathMatch) detailSection = `\nFILE: ${pathMatch[1]}`;
  } else if (toolName === 'write') {
    const pathMatch = command.match(/(?:file[_\s]*path|path)[:\s]+([^\s,]+)/i);
    if (pathMatch) detailSection = `\nFILE: ${pathMatch[1]}`;
  }
  return `TOOL: ${toolName}\nPARAMS: ${command}${detailSection}`;
}

function scoreToVerdict(score) {
  if (score <= 3) return 'SAFE';
  if (score <= 7) return 'WARNING';
  return 'BLOCK';
}

// ─── Preview mode: `node export-training-data.js preview [N]` ────────────────

if (process.argv[2] === 'preview') {
  const n = parseInt(process.argv[3]) || 1;
  const memDb = new Database(path.join(process.cwd(), '.guardclaw', 'memory.db'), { readonly: true });
  const rows = memDb.prepare('SELECT * FROM decisions WHERE riskScore IS NOT NULL LIMIT ?').all(n);
  for (const d of rows) {
    let adjustedScore = d.riskScore;
    if (d.decision === 'approve' && d.riskScore >= 8) adjustedScore = Math.max(5, d.riskScore - 2);
    else if (d.decision === 'deny' && d.riskScore < 8) adjustedScore = Math.max(d.riskScore, 8);
    const verdict = scoreToVerdict(adjustedScore);
    const reason = d.decision === 'deny'
      ? `${d.toolName === 'exec' ? 'Dangerous command' : 'Risky action'} — ${d.command.slice(0, 100)}`
      : `${d.toolName === 'exec' ? 'Acceptable command' : 'Safe action'} — ${d.command.slice(0, 100)}`;

    console.log('═══ SYSTEM ═══');
    console.log(SYSTEM_PROMPT);
    console.log();
    console.log('═══ USER ═══');
    console.log(buildUserPrompt(d.toolName, d.command));
    console.log();
    console.log('═══ ASSISTANT ═══');
    console.log(JSON.stringify({ verdict, reason }));
    console.log();
    if (n > 1) console.log('─'.repeat(60));
  }
  memDb.close();
  process.exit(0);
}

// ─── Collect from memory decisions ───────────────────────────────────────────

const samples = [];
const memDb = new Database(path.join(process.cwd(), '.guardclaw', 'memory.db'), { readonly: true });
const decisions = memDb.prepare('SELECT * FROM decisions WHERE riskScore IS NOT NULL').all();

for (const d of decisions) {
  // Adjust score based on user's actual decision
  let adjustedScore = d.riskScore;
  if (d.decision === 'approve' && d.riskScore >= 8) {
    adjustedScore = Math.max(5, d.riskScore - 2); // user approved → lower
  } else if (d.decision === 'deny' && d.riskScore < 8) {
    adjustedScore = Math.max(d.riskScore, 8); // user denied → raise
  }

  const verdict = scoreToVerdict(adjustedScore);
  const reason = d.decision === 'deny'
    ? `${d.toolName === 'exec' ? 'Dangerous command' : 'Risky action'} — ${d.command.slice(0, 100)}`
    : `${d.toolName === 'exec' ? 'Acceptable command' : 'Safe action'} — ${d.command.slice(0, 100)}`;

  samples.push({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(d.toolName, d.command) },
      { role: 'assistant', content: JSON.stringify({ verdict, reason }) },
    ],
  });
}

console.log(`[Memory] ${decisions.length} decisions → ${samples.length} samples`);

// ─── Synthetic safe samples (memory only records high-risk decisions) ────────

const safeCmds = [
  // exec — SAFE
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
  // non-exec — SAFE
  ['read', '/Users/user/project/src/app.js', 'Reading project source file — safe'],
  ['read', '/Users/user/project/package.json', 'Reading project config — safe'],
  ['read', '/Users/user/project/README.md', 'Reading documentation — safe'],
  ['grep', '"pattern":"TODO","path":"src/"', 'Searching project code — read-only'],
  ['glob', '"pattern":"**/*.js","path":"src/"', 'Finding project files — read-only'],
  ['edit', 'edit file: ~/project/src/app.js, old_string: "foo", new_string: "bar"', 'Editing project source — normal development'],
  ['write', 'path: ~/project/src/new-file.js, content: "export default {}"', 'Writing new project file — normal development'],
  ['web_search', 'query: "react useState hook"', 'Documentation search — safe'],
  ['agent_spawn', 'prompt: "find the bug in auth.js"', 'Spawning subagent for code review — normal workflow'],
];

for (const [tool, input, reason] of safeCmds) {
  samples.push({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(tool, input) },
      { role: 'assistant', content: JSON.stringify({ verdict: 'SAFE', reason }) },
    ],
  });
}

console.log(`[Synthetic] Added ${safeCmds.length} safe samples for balance`);

// ─── Balance info ────────────────────────────────────────────────────────────

const byVerdict = { SAFE: 0, WARNING: 0, BLOCK: 0 };
for (const s of samples) {
  const parsed = JSON.parse(s.messages[2].content);
  byVerdict[parsed.verdict] = (byVerdict[parsed.verdict] || 0) + 1;
}
console.log(`[Balance] SAFE: ${byVerdict.SAFE}, WARNING: ${byVerdict.WARNING}, BLOCK: ${byVerdict.BLOCK}`);

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
