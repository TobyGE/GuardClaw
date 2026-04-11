#!/usr/bin/env node
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createInterface } from 'readline';
import fs from 'fs';
import os from 'os';

import { getMenuPageSize, getMenuViewport } from './select-menu.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const command = process.argv[2];
const GC_PORT = parseInt(process.env.GUARDCLAW_PORT || process.env.PORT || 3002);
const GC_BASE = `http://127.0.0.1:${GC_PORT}`;

// ─── API helper ───────────────────────────────────────────────────────────────

async function gcApi(path, method = 'GET', body, { silent = false } = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${GC_BASE}${path}`, opts);
    if (!res.ok) {
      // Try to surface the server's error message instead of just "HTTP 400".
      let detail = `HTTP ${res.status}`;
      try {
        const text = await res.text();
        if (text) {
          try {
            const j = JSON.parse(text);
            detail = j.error || j.message || text.substring(0, 200);
          } catch {
            detail = text.substring(0, 200);
          }
        }
      } catch {}
      throw new Error(detail);
    }
    return await res.json();
  } catch (err) {
    const offline = err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED';
    if (silent) {
      // Caller is happy to proceed without the server — just signal absence.
      const e = new Error(offline ? 'server-offline' : err.message);
      e.offline = offline;
      throw e;
    }
    if (offline) {
      console.error(`❌ GuardClaw is not running (port ${GC_PORT})`);
      console.error('   Start it with: guardclaw start');
    } else {
      console.error(`❌ API error: ${err.message}`);
    }
    process.exit(1);
  }
}

// ─── Hot-reload helper ──────────────────────────────────────────────────────
// After writing .env, try to push the change to a running server via its API.
// If the server is offline, offer to restart it (or start it).

async function tryHotReload(configType, body, successMsg) {
  // Try the server API first
  try {
    const endpoint = configType === 'llm' ? '/api/config/llm' : null;
    if (endpoint) {
      await gcApi(endpoint, 'POST', body, { silent: true });
      console.log(`\n✅ ${successMsg} — applied to running server\n`);
      return;
    }
  } catch (e) {
    if (!e.offline) {
      // Server is up but rejected — config saved, needs restart
      console.log(`\n✅ ${successMsg}`);
    }
  }

  // Server offline or no hot-reload endpoint — offer restart
  const isRunning = isServerRunning();
  if (isRunning) {
    console.log(`\n✅ ${successMsg}`);
    if (process.stdin.isTTY) {
      const choice = await select([
        { label: 'Restart now', value: 'restart', hint: 'apply changes immediately' },
        { label: 'Later',       value: 'later',   hint: 'restart manually with guardclaw start' },
      ]);
      if (choice === 'restart') {
        await restartServer();
        return;
      }
    }
    console.log('  Run `guardclaw stop && guardclaw start` to apply.\n');
  } else {
    console.log(`\n✅ ${successMsg}`);
    if (process.stdin.isTTY) {
      const choice = await select([
        { label: 'Start now', value: 'start', hint: 'start the server' },
        { label: 'Later',     value: 'later', hint: 'start manually with guardclaw start' },
      ]);
      if (choice === 'start') {
        await startServer();
        return;
      }
    }
    console.log('  Run `guardclaw start` to apply.\n');
  }
}

function isServerRunning() {
  try {
    const out = execSync('ps ax -o pid= -o command=', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    for (const line of out.split('\n')) {
      if (line.includes('server/index.js') && /guardclaw/i.test(line)) return true;
    }
  } catch {}
  return false;
}

// ─── Interactive prompt helpers (arrow-key navigation) ───────────────────────

function createPrompt() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, a => resolve(a.trim())));
}

/**
 * Arrow-key menu selector. Returns the value of the chosen option.
 * options: [{ label: 'display text', value: 'return value', hint?: 'gray hint' }]
 */
function select(options, { title, defaultIndex = 0 } = {}) {
  return new Promise((resolve) => {
    let cursor = defaultIndex;
    let offset = 0;
    const { stdin, stdout } = process;
    const wasRaw = stdin.isRaw;
    const titleLines = title ? title.split('\n').length : 0;
    const pageSize = getMenuPageSize(options.length, stdout.rows, titleLines);
    const hasOverflow = options.length > pageSize;
    const renderLines = pageSize + 1 + (hasOverflow ? 2 : 0);

    function render() {
      const viewport = getMenuViewport(options.length, cursor, pageSize, offset);
      offset = viewport.offset;

      stdout.write(`\x1b[${renderLines}A`);

      if (hasOverflow) {
        const topLine = viewport.above ? `  \x1b[90m↑ ${viewport.above} more\x1b[0m` : '';
        stdout.write(`\x1b[2K${topLine}\n`);
      }

      for (let i = viewport.start; i < viewport.end; i++) {
        const opt = options[i];
        const selected = i === cursor;
        const pointer = selected ? '\x1b[36m❯\x1b[0m' : ' ';
        const label = selected ? `\x1b[1m${opt.label}\x1b[0m` : opt.label;
        const hint = opt.hint ? `  \x1b[90m${opt.hint}\x1b[0m` : '';
        stdout.write(`\x1b[2K  ${pointer} ${label}${hint}\n`);
      }

      if (hasOverflow) {
        const bottomLine = viewport.below ? `  \x1b[90m↓ ${viewport.below} more\x1b[0m` : '';
        stdout.write(`\x1b[2K${bottomLine}\n`);
      }

      const footer = `  \x1b[90m${cursor + 1}/${options.length} · ↑↓ to scroll · Enter to select\x1b[0m`;
      stdout.write(`\x1b[2K${footer}\n`);
    }

    if (title) stdout.write(`${title}\n`);
    for (let i = 0; i < renderLines; i++) stdout.write('\n');
    render();

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    function onKey(key) {
      if (key === '\x1b[A' || key === 'k') { // up
        cursor = (cursor - 1 + options.length) % options.length;
        render();
      } else if (key === '\x1b[B' || key === 'j') { // down
        cursor = (cursor + 1) % options.length;
        render();
      } else if (key === '\r' || key === '\n') { // enter
        cleanup();
        resolve(options[cursor].value);
      } else if (key === '\x03') { // ctrl-c
        cleanup();
        process.exit(0);
      }
    }

    function cleanup() {
      stdin.removeListener('data', onKey);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
    }

    stdin.on('data', onKey);
  });
}

/**
 * Arrow-key yes/no confirm. Returns boolean.
 */
function confirm(question, { defaultYes = true } = {}) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    const wasRaw = stdin.isRaw;
    let value = defaultYes;

    function render() {
      const yes = value ? '\x1b[1m\x1b[36m● Yes\x1b[0m' : '○ Yes';
      const no = !value ? '\x1b[1m\x1b[36m● No\x1b[0m' : '○ No';
      stdout.write(`\x1b[2K\r  ${question} ${yes}  ${no}`);
    }

    render();

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    function onKey(key) {
      if (key === '\x1b[C' || key === '\x1b[D' || key === 'h' || key === 'l' || key === '\t') {
        value = !value;
        render();
      } else if (key === 'y' || key === 'Y') {
        value = true; cleanup(); stdout.write('\n'); resolve(true);
      } else if (key === 'n' || key === 'N') {
        value = false; cleanup(); stdout.write('\n'); resolve(false);
      } else if (key === '\r' || key === '\n') {
        cleanup(); stdout.write('\n'); resolve(value);
      } else if (key === '\x03') {
        cleanup(); process.exit(0);
      }
    }

    function cleanup() {
      stdin.removeListener('data', onKey);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
    }

    stdin.on('data', onKey);
  });
}

// ─── .env helpers ─────────────────────────────────────────────────────────────

function getEnvPath() {
  return join(os.homedir(), '.guardclaw', '.env');
}

function readEnvFile() {
  try { return fs.readFileSync(getEnvPath(), 'utf8'); } catch { return ''; }
}

function writeEnvFile(content) {
  fs.mkdirSync(join(os.homedir(), '.guardclaw'), { recursive: true });
  fs.writeFileSync(getEnvPath(), content, 'utf8');
}

function setEnvVar(env, key, value) {
  const re = new RegExp(`^${key}=.*`, 'm');
  return re.test(env) ? env.replace(re, `${key}=${value}`) : env.trimEnd() + `\n${key}=${value}\n`;
}

function getEnvVar(env, key) {
  const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : null;
}

// ─── Hook script sync ─────────────────────────────────────────────────────────

const HOOKS_DIR = join(os.homedir(), '.guardclaw', 'hooks');
const HOOK_SCRIPTS = ['codex-hook.sh', 'gemini-hook.sh', 'cursor-hook.sh', 'copilot-hook.sh'];

function syncHookScripts() {
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  let synced = 0;
  for (const name of HOOK_SCRIPTS) {
    const src = join(rootDir, 'scripts', name);
    const dst = join(HOOKS_DIR, name);
    if (!fs.existsSync(src)) continue;
    const srcContent = fs.readFileSync(src, 'utf8');
    let needsUpdate = true;
    try { needsUpdate = fs.readFileSync(dst, 'utf8') !== srcContent; } catch {}
    if (needsUpdate) {
      fs.writeFileSync(dst, srcContent);
      fs.chmodSync(dst, 0o755);
      synced++;
    }
  }
  if (synced > 0) console.log(`  Synced ${synced} hook script(s) to ${HOOKS_DIR}`);
}

function hookScriptPath(name) {
  return join(HOOKS_DIR, name);
}

// ─── Install / onboarding state ───────────────────────────────────────────────

// Onboarding marker lives in ~/.guardclaw/ (global), NOT in the project
// directory. Otherwise every new project would re-trigger the wizard, which
// is annoying and pointless — onboarding configures user-level preferences,
// not per-project state.
function getGlobalInstallJsonPath() {
  return join(os.homedir(), '.guardclaw', 'install.json');
}

function isOnboardingDone() {
  // 1. Explicit global marker
  try {
    if (JSON.parse(fs.readFileSync(getGlobalInstallJsonPath(), 'utf8')).onboardingCompleted) return true;
  } catch {}
  // 2. Legacy: project-local marker from older versions
  try {
    const legacy = join(process.cwd(), '.guardclaw', 'install.json');
    if (JSON.parse(fs.readFileSync(legacy, 'utf8')).onboardingCompleted) return true;
  } catch {}
  // 3. .env 已有核心配置 → 老用户，跳过 onboarding
  const env = readEnvFile();
  if (getEnvVar(env, 'SAFEGUARD_BACKEND')) return true;
  return false;
}

function markOnboardingDone() {
  const p = getGlobalInstallJsonPath();
  fs.mkdirSync(join(os.homedir(), '.guardclaw'), { recursive: true });
  let d = {};
  try { d = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  d.onboardingCompleted = true;
  d.onboardingAt = d.onboardingAt || new Date().toISOString();
  if (!d.installedAt) d.installedAt = d.onboardingAt;
  fs.writeFileSync(p, JSON.stringify(d, null, 2));
}

// ─── Cloud-judge persisted config ─────────────────────────────────────────────
// Mirrors server/cloud-judge.js CONFIG_FILE so onboarding can seed config
// before the server is even running.

const CLOUD_JUDGE_CONFIG_FILE = join(os.homedir(), '.guardclaw', 'cloud-judge-config.json');

function writePersistedCloudJudgeConfig(patch) {
  try {
    fs.mkdirSync(join(os.homedir(), '.guardclaw'), { recursive: true });
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(CLOUD_JUDGE_CONFIG_FILE, 'utf8')); } catch {}
    const merged = { ...existing, ...patch };
    fs.writeFileSync(CLOUD_JUDGE_CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
  } catch (e) {
    console.error(`  ⚠️  Could not save cloud-judge config: ${e.message}`);
  }
}

// ─── Claude Code hook helpers ─────────────────────────────────────────────────

const CLAUDE_SETTINGS = join(os.homedir(), '.claude', 'settings.json');
const CLAUDE_HOOK_URLS = [
  '/api/hooks/pre-tool-use',
  '/api/hooks/post-tool-use',
  '/api/hooks/stop',
  '/api/hooks/user-prompt',
];

function isGCClaudeHook(group) {
  return group?.hooks?.some(h => CLAUDE_HOOK_URLS.some(u => h.url?.includes(u)));
}

function isClaudeCodeHooksInstalled() {
  try {
    const s = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
    return Object.values(s.hooks || {}).flat().some(g => isGCClaudeHook(g));
  } catch { return false; }
}

function installClaudeCodeHooks(port = GC_PORT) {
  fs.mkdirSync(join(os.homedir(), '.claude'), { recursive: true });
  let s = {};
  try { s = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8')); } catch {}
  if (!s.hooks) s.hooks = {};

  const hooks = {
    PreToolUse:       [{ matcher: '', hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/api/hooks/pre-tool-use`,  timeout: 300, statusMessage: '⏳ GuardClaw evaluating...' }] }],
    PostToolUse:      [{ matcher: '', hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/api/hooks/post-tool-use`, timeout: 10  }] }],
    Stop:             [{ matcher: '', hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/api/hooks/stop`,          timeout: 10  }] }],
    UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/api/hooks/user-prompt`,  timeout: 5   }] }],
  };

  for (const event of Object.keys(hooks)) {
    s.hooks[event] = (s.hooks[event] || []).filter(g => !isGCClaudeHook(g));
    s.hooks[event].push(...hooks[event]);
  }
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(s, null, 2) + '\n');
}

function uninstallClaudeCodeHooks() {
  if (!fs.existsSync(CLAUDE_SETTINGS)) return;
  const s = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
  if (!s.hooks) return;
  for (const event of Object.keys(s.hooks)) {
    s.hooks[event] = s.hooks[event].filter(g => !isGCClaudeHook(g));
    if (!s.hooks[event].length) delete s.hooks[event];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(s, null, 2) + '\n');
}

// ─── Codex hook helpers ───────────────────────────────────────────────────────

const CODEX_HOOKS_FILE = join(os.homedir(), '.codex', 'hooks.json');
const CODEX_HOOK_SCRIPT = hookScriptPath('codex-hook.sh');

function isGCCodexHook(group) {
  return group?.hooks?.some(h => h.command?.includes('codex-hook.sh'));
}

function isCodexHooksInstalled() {
  try {
    const c = JSON.parse(fs.readFileSync(CODEX_HOOKS_FILE, 'utf8'));
    return Object.values(c.hooks || {}).flat().some(g => isGCCodexHook(g));
  } catch { return false; }
}

function installCodexHooks() {
  fs.mkdirSync(join(os.homedir(), '.codex'), { recursive: true });
  if (fs.existsSync(CODEX_HOOK_SCRIPT)) fs.chmodSync(CODEX_HOOK_SCRIPT, 0o755);

  let c = {};
  try { c = JSON.parse(fs.readFileSync(CODEX_HOOKS_FILE, 'utf8')); } catch {}
  if (!c.hooks) c.hooks = {};

  const events = { PreToolUse: 310, UserPromptSubmit: 10, Stop: 10 };
  for (const [event, timeout] of Object.entries(events)) {
    c.hooks[event] = (c.hooks[event] || []).filter(g => !isGCCodexHook(g));
    c.hooks[event].push({ matcher: '', hooks: [{ type: 'command', command: CODEX_HOOK_SCRIPT, timeout }] });
  }
  fs.writeFileSync(CODEX_HOOKS_FILE, JSON.stringify(c, null, 2) + '\n');
}

function uninstallCodexHooks() {
  if (!fs.existsSync(CODEX_HOOKS_FILE)) return;
  const c = JSON.parse(fs.readFileSync(CODEX_HOOKS_FILE, 'utf8'));
  if (!c.hooks) return;
  for (const event of Object.keys(c.hooks)) {
    c.hooks[event] = c.hooks[event].filter(g => !isGCCodexHook(g));
    if (!c.hooks[event].length) delete c.hooks[event];
  }
  if (!Object.keys(c.hooks).length) delete c.hooks;
  fs.writeFileSync(CODEX_HOOKS_FILE, JSON.stringify(c, null, 2) + '\n');
}

// ─── Agent detection ──────────────────────────────────────────────────────────

// ─── Gemini CLI hook helpers ─────────────────────────────────────────────────

const GEMINI_SETTINGS = join(os.homedir(), '.gemini', 'settings.json');
const GEMINI_HOOK_SCRIPT = hookScriptPath('gemini-hook.sh');

function isGeminiHooksInstalled() {
  try {
    const s = JSON.parse(fs.readFileSync(GEMINI_SETTINGS, 'utf8'));
    const hooks = s.hooksConfig?.hooks || {};
    return Object.values(hooks).flat().some(h => h.command?.includes('gemini-hook.sh'));
  } catch { return false; }
}

function installGeminiHooks() {
  if (fs.existsSync(GEMINI_HOOK_SCRIPT)) fs.chmodSync(GEMINI_HOOK_SCRIPT, 0o755);
  let s = {};
  try { s = JSON.parse(fs.readFileSync(GEMINI_SETTINGS, 'utf8')); } catch {}
  if (!s.hooksConfig) s.hooksConfig = {};
  if (!s.hooksConfig.hooks) s.hooksConfig.hooks = {};
  const cmd = GEMINI_HOOK_SCRIPT;
  s.hooksConfig.hooks.PreToolUse = [{ command: cmd, timeout: 310 }];
  s.hooksConfig.hooks.PostToolUse = [{ command: cmd, timeout: 10 }];
  s.hooksConfig.hooks.Stop = [{ command: cmd, timeout: 10 }];
  fs.writeFileSync(GEMINI_SETTINGS, JSON.stringify(s, null, 2) + '\n');
}

// ─── Cursor hook helpers ─────────────────────────────────────────────────────

const CURSOR_HOOKS_FILE = join(os.homedir(), '.cursor', 'hooks.json');
const CURSOR_HOOK_SCRIPT = hookScriptPath('cursor-hook.sh');

function isCursorHooksInstalled() {
  try {
    const c = JSON.parse(fs.readFileSync(CURSOR_HOOKS_FILE, 'utf8'));
    const hooks = c.hooks || {};
    return Object.values(hooks).flat().some(h => h.command?.includes('cursor-hook.sh'));
  } catch { return false; }
}

function installCursorHooks() {
  fs.mkdirSync(join(os.homedir(), '.cursor'), { recursive: true });
  if (fs.existsSync(CURSOR_HOOK_SCRIPT)) fs.chmodSync(CURSOR_HOOK_SCRIPT, 0o755);
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CURSOR_HOOKS_FILE, 'utf8')); } catch {}
  if (!c.version) c.version = 1;
  if (!c.hooks) c.hooks = {};
  const cmd = `GUARDCLAW_PORT=${GC_PORT} ${CURSOR_HOOK_SCRIPT}`;
  c.hooks.beforeShellExecution = [{ command: cmd, type: 'command', timeout: 310 }];
  c.hooks.afterShellExecution = [{ command: cmd, type: 'command', timeout: 5 }];
  c.hooks.afterFileEdit = [{ command: cmd, type: 'command', timeout: 5 }];
  fs.writeFileSync(CURSOR_HOOKS_FILE, JSON.stringify(c, null, 2) + '\n');
}

// ─── Copilot CLI hook helpers ────────────────────────────────────────────────

const COPILOT_HOOK_SCRIPT = hookScriptPath('copilot-hook.sh');

function isCopilotHooksInstalled() {
  // Copilot CLI uses Claude Code's settings.json hooks with copilot: prefix session IDs
  return isClaudeCodeHooksInstalled();
}

// ─── OpenCode hook helpers ───────────────────────────────────────────────────

const OPENCODE_CONFIG_DIR = join(os.homedir(), '.config', 'opencode');
const OPENCODE_PLUGIN_DIR = join(OPENCODE_CONFIG_DIR, 'plugins');

function isOpenCodeInstalled() {
  return fs.existsSync(OPENCODE_CONFIG_DIR);
}

function detectAgents() {
  const env = readEnvFile();
  const agents = [];

  // Claude Code
  if (fs.existsSync(join(os.homedir(), '.claude'))) {
    agents.push({ id: 'claude-code', label: 'Claude Code', type: 'hook', installed: isClaudeCodeHooksInstalled() });
  }

  // Codex
  if (fs.existsSync(join(os.homedir(), '.codex'))) {
    agents.push({ id: 'codex', label: 'Codex', type: 'hook', installed: isCodexHooksInstalled() });
  }

  // Gemini CLI
  if (fs.existsSync(join(os.homedir(), '.gemini'))) {
    agents.push({ id: 'gemini', label: 'Gemini CLI', type: 'hook', installed: isGeminiHooksInstalled() });
  }

  // Cursor
  if (fs.existsSync(join(os.homedir(), '.cursor'))) {
    agents.push({ id: 'cursor', label: 'Cursor', type: 'hook', installed: isCursorHooksInstalled() });
  }

  // Copilot CLI (shares CC hooks)
  if (fs.existsSync(join(os.homedir(), '.copilot'))) {
    agents.push({ id: 'copilot', label: 'Copilot CLI', type: 'hook', installed: isCopilotHooksInstalled() });
  }

  // OpenCode
  if (isOpenCodeInstalled()) {
    agents.push({ id: 'opencode', label: 'OpenCode', type: 'hook', installed: false });
  }

  // OpenClaw
  try {
    const cfg = JSON.parse(fs.readFileSync(join(os.homedir(), '.openclaw', 'openclaw.json'), 'utf8'));
    const token = cfg?.gateway?.auth?.token;
    if (token) {
      agents.push({ id: 'openclaw', label: 'OpenClaw', type: 'ws', token,
        installed: getEnvVar(env, 'OPENCLAW_TOKEN') === token });
    }
  } catch {}

  // Qclaw
  try {
    const cfg = JSON.parse(fs.readFileSync(join(os.homedir(), '.qclaw', 'openclaw.json'), 'utf8'));
    const token = cfg?.gateway?.auth?.token;
    if (token) {
      agents.push({ id: 'qclaw', label: 'Qclaw', type: 'ws', token,
        installed: getEnvVar(env, 'QCLAW_TOKEN') === token });
    }
  } catch {}

  return agents;
}

// ─── Model selection helpers ──────────────────────────────────────────────────

const KNOWN_MODELS = {
  anthropic: [
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-6',
    'claude-opus-4-6',
    'claude-3-5-haiku-20241022',
    'claude-3-5-sonnet-20241022',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'o1',
    'o1-mini',
    'gpt-3.5-turbo',
  ],
  gemini: [
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ],
  openrouter: [
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-haiku-4-5',
    'google/gemini-2.0-flash-001',
    'meta-llama/llama-3.3-70b-instruct',
    'deepseek/deepseek-r1',
    'qwen/qwen3-235b-a22b',
  ],
  minimax: [
    'MiniMax-M2.7',
    'MiniMax-M2.7-highspeed',
    'MiniMax-M2.5',
    'MiniMax-M2.5-highspeed',
    'MiniMax-M2.1',
    'MiniMax-M1',
    'MiniMax-Text-01',
  ],
};

/** Fetch available models for a backend. Returns [] on failure. */
async function fetchModels(backend, baseUrl, apiKey) {
  try {
    if (backend === 'lmstudio') {
      const url = (baseUrl || 'http://localhost:1234/v1').replace(/\/$/, '');
      const headers = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const res = await fetch(`${url}/models`, { headers, signal: AbortSignal.timeout(4000) });
      const data = await res.json();
      return (data.data || []).map(m => m.id).filter(id => !id.includes('embedding'));
    }
    if (backend === 'ollama') {
      const url = (baseUrl || 'http://localhost:11434').replace(/\/$/, '');
      const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(4000) });
      const data = await res.json();
      return (data.models || []).map(m => m.name);
    }
    if (backend === 'built-in') {
      // Built-in models are managed by the GuardClaw server itself. If the
      // server isn't running yet (e.g. during the start-time onboarding),
      // we can't enumerate them — return [] and let the caller handle it.
      const res = await fetch(`${GC_BASE}/api/models`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.models || []).filter(m => m.downloaded || m.loaded).map(m => m.id);
    }
    if (backend === 'anthropic' && apiKey) {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = await res.json();
        return (data.data || []).map(m => m.id).filter(id => id.startsWith('claude-'));
      }
    }
    if (backend === 'openai' && apiKey) {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = await res.json();
        return (data.data || [])
          .map(m => m.id)
          .filter(id => /^(gpt|o\d|chatgpt)/.test(id))
          .sort();
      }
    }
    if (backend === 'gemini' && apiKey) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (res.ok) {
        const data = await res.json();
        return (data.models || [])
          .map(m => m.name.replace('models/', ''))
          .filter(id => id.startsWith('gemini-'));
      }
    }
    if (backend === 'minimax') {
      // MiniMax doesn't have /models — return known list directly
      return KNOWN_MODELS.minimax;
    }
    if (backend === 'openrouter') {
      // OpenRouter /models is public — no auth needed
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = await res.json();
        return (data.data || [])
          .map(m => m.id)
          .sort();
      }
    }
  } catch {}
  // fallback to known list
  return KNOWN_MODELS[backend] || [];
}

/**
 * Arrow-key model picker. Returns the chosen model string.
 */
async function pickModel(rl, models, current, fallback) {
  const def = current || fallback || models[0];
  if (!models.length) return null;

  const options = models.map(m => ({
    label: m,
    value: m,
    hint: m === current ? '◀ current' : undefined,
  }));
  options.push({ label: 'Enter manually...', value: '__manual__' });

  const defaultIdx = current ? Math.max(0, models.indexOf(current)) : 0;
  const choice = await select(options, { title: '', defaultIndex: defaultIdx });

  if (choice === '__manual__') {
    const rl2 = createPrompt();
    const name = await ask(rl2, '  Model name: ');
    rl2.close();
    return name || def;
  }
  return choice;
}

// ─── Onboarding wizard ────────────────────────────────────────────────────────

async function runOnboarding() {
  console.log('\n⛨ Welcome to GuardClaw!\n');
  console.log('  GuardClaw is an independent safety monitor for AI coding agents.');
  console.log('  It sits between your agent (Claude Code, Codex, Gemini, etc.) and');
  console.log('  the tools it uses — evaluating every tool call in real time.\n');
  console.log('  • Scores every tool call before execution (1-10 risk scale)');
  console.log('  • Auto-approves safe operations, blocks dangerous ones');
  console.log('  • Learns from your decisions to reduce interruptions over time');
  console.log('  • Supports Claude Code, Codex, Gemini CLI, and more\n');
  console.log('  Let\'s get you set up in 4 quick steps.\n');
  console.log('Use ↑↓ arrow keys to navigate, Enter to select.\n');

  let env = readEnvFile();

  // ── Step 1: Evaluation mode ─────────────────────────────────────────────────
  console.log('── Step 1 of 4: Evaluation mode ────────────────────────────────────\n');

  const judgeMode = await select([
    { label: 'Local only',     value: 'local-only',  hint: 'private, fast, single LLM' },
    { label: 'Mixed',          value: 'mixed',       hint: 'local first, cloud escalates risky calls (recommended)' },
    { label: 'Cloud only',     value: 'cloud-only',  hint: 'all evaluation via cloud API' },
  ], { defaultIndex: 1 });
  console.log(`  → ${judgeMode}\n`);

  // ── Step 2: LLM backend(s) ───────────────────────────────────────────────────
  let cloudProvider = null;
  let cloudApiKey = '';
  let pendingOAuth = null;

  if (judgeMode === 'local-only') {
    console.log('── Step 2 of 4: Local LLM backend ──────────────────────────────────\n');
  } else if (judgeMode === 'cloud-only') {
    console.log('── Step 2 of 4: Cloud LLM provider ─────────────────────────────────\n');
  } else {
    console.log('── Step 2 of 4: Local LLM backend ──────────────────────────────────\n');
    console.log('  Mixed mode: first pick your local backend, then the cloud provider.\n');
  }

  // Pick local backend (skip for cloud-only)
  let backend = 'fallback';
  if (judgeMode !== 'cloud-only') {
    backend = await select([
      { label: 'LM Studio',  value: 'lmstudio',  hint: 'local, recommended' },
      { label: 'Ollama',     value: 'ollama',     hint: 'local' },
      { label: 'Built-in',   value: 'built-in',   hint: 'Apple Silicon, download model' },
      { label: 'Fallback',   value: 'fallback',   hint: 'rule-based only, no LLM' },
    ]);
    env = setEnvVar(env, 'SAFEGUARD_BACKEND', backend);
    console.log(`  → local: ${backend}\n`);
  } else {
    env = setEnvVar(env, 'SAFEGUARD_BACKEND', 'fallback');
  }

  if (backend === 'lmstudio') {
    const rl = createPrompt();
    const url = await ask(rl, '  LM Studio URL [http://localhost:1234/v1]: ');
    rl.close();
    const resolvedUrl = url || 'http://localhost:1234/v1';
    env = setEnvVar(env, 'LMSTUDIO_URL', resolvedUrl);
    process.stdout.write('  Fetching models...');
    const models = await fetchModels('lmstudio', resolvedUrl);
    process.stdout.write(models.length ? ` ${models.length} found\n` : ' (none found, enter manually)\n');
    if (models.length) {
      const model = await pickModel(null, models, null, 'auto');
      env = setEnvVar(env, 'LMSTUDIO_MODEL', model || 'auto');
    } else {
      const rl2 = createPrompt();
      const model = await ask(rl2, '  Model name [auto]: ');
      rl2.close();
      env = setEnvVar(env, 'LMSTUDIO_MODEL', model || 'auto');
    }
  } else if (backend === 'ollama') {
    const rl = createPrompt();
    const url = await ask(rl, '  Ollama URL [http://localhost:11434]: ');
    rl.close();
    const resolvedUrl = url || 'http://localhost:11434';
    env = setEnvVar(env, 'OLLAMA_URL', resolvedUrl);
    process.stdout.write('  Fetching models...');
    const models = await fetchModels('ollama', resolvedUrl);
    process.stdout.write(models.length ? ` ${models.length} found\n` : ' (none found, enter manually)\n');
    if (models.length) {
      const model = await pickModel(null, models, null, 'llama3');
      env = setEnvVar(env, 'OLLAMA_MODEL', model || 'llama3');
    } else {
      const rl2 = createPrompt();
      const model = await ask(rl2, '  Model name [llama3]: ');
      rl2.close();
      env = setEnvVar(env, 'OLLAMA_MODEL', model || 'llama3');
    }
  } else if (backend === 'built-in') {
    // The built-in MLX engine is managed by the GuardClaw server itself, so
    // we cannot download or load a model from inside onboarding (the server
    // isn't up yet — that's the chicken-and-egg the user reported). Just save
    // the backend choice and direct the user to the dashboard for the
    // one-click model setup once the server is running.
    console.log('');
    console.log('  ℹ️  Built-in models are downloaded after the server starts.');
    console.log('     After setup finishes, open the dashboard → Settings → Built-in');
    console.log('     to download and load a model. GuardClaw will fall back to');
    console.log('     rule-based scoring until a model is loaded.\n');
  } else if (backend === 'fallback' && judgeMode !== 'cloud-only') {
    console.log('  ℹ️  Rule-based only — no LLM calls. You can switch later via `guardclaw config llm`.\n');
  }

  // Pick cloud provider (for mixed + cloud-only)
  if (judgeMode === 'mixed' || judgeMode === 'cloud-only') {
    if (judgeMode === 'mixed') {
      console.log('\n  Now pick the cloud provider for escalation:\n');
    }
    if (judgeMode === 'cloud-only') {
      console.log('');
    }

    cloudProvider = await select([
      { label: 'Anthropic Claude',          value: 'claude',        hint: 'OAuth login or API key' },
      { label: 'OpenAI Codex (ChatGPT)',    value: 'openai-codex',  hint: 'OAuth login (ChatGPT Plus/Pro)' },
      { label: 'MiniMax',                   value: 'minimax',       hint: 'OAuth login or API key' },
      { label: 'Kimi (Moonshot)',           value: 'kimi',          hint: 'API key' },
      { label: 'OpenRouter',                value: 'openrouter',    hint: '400+ models, API key' },
      { label: 'Google Gemini',             value: 'gemini',        hint: 'API key' },
      { label: 'OpenAI',                    value: 'openai',        hint: 'API key' },
    ]);
    console.log(`  → cloud: ${cloudProvider}\n`);

    // Get API key for non-OAuth providers (or optionally for Claude/OpenAI Codex)
    const oauthProviders = new Set(['claude', 'openai-codex', 'minimax']);
    if (!oauthProviders.has(cloudProvider)) {
      const rl = createPrompt();
      const key = await ask(rl, `  ${cloudProvider} API key: `);
      rl.close();
      cloudApiKey = key || '';
      if (!key) console.log('  (skipped — configure later in Settings)\n');
    } else {
      const label = cloudProvider === 'openai-codex' ? 'OpenAI Codex' : cloudProvider === 'minimax' ? 'MiniMax' : 'Claude';
      const authMethod = await select([
        { label: 'OAuth login', value: 'oauth', hint: `sign in with your ${label} account after server starts` },
        { label: 'API key',     value: 'apikey', hint: 'paste key now' },
        { label: 'Skip',        value: 'skip',   hint: 'configure later in Settings' },
      ]);

      if (authMethod === 'apikey') {
        const rl = createPrompt();
        const key = await ask(rl, `  ${label} API key: `);
        rl.close();
        cloudApiKey = key || '';
      } else if (authMethod === 'oauth') {
        // Mark pending OAuth — server will trigger the flow on startup
        pendingOAuth = cloudProvider;
        console.log(`\n  OAuth login will open in your browser after the server starts.\n`);
      }
    }

    // Apply cloud judge config via API (silent: server may not be up yet
    // during the start-time onboarding — that's the whole point of running
    // this wizard before the server spawns).
    try {
      await gcApi('/api/config/cloud-judge', 'POST', {
        enabled: true,
        judgeMode,
        provider: cloudProvider,
        ...(cloudApiKey ? { apiKey: cloudApiKey } : {}),
      }, { silent: true });
      console.log('  ✅ Cloud judge configured\n');
    } catch (e) {
      // Server isn't up yet — write the persisted config file directly so it
      // takes effect the moment the server boots.
      writePersistedCloudJudgeConfig({
        enabled: true,
        judgeMode,
        provider: cloudProvider,
        ...(cloudApiKey ? { apiKey: cloudApiKey } : {}),
      });
      console.log('  ✅ Cloud judge saved (will activate on server start)\n');
    }
  } else {
    // local-only: disable cloud judge
    try {
      await gcApi('/api/config/cloud-judge', 'POST', { enabled: false, judgeMode: 'local-only' }, { silent: true });
    } catch {
      writePersistedCloudJudgeConfig({ enabled: false, judgeMode: 'local-only' });
    }
  }

  // ── Step 3: Approval mode ────────────────────────────────────────────────────
  console.log('── Step 3 of 4: Response mode ───────────────────────────────────────\n');
  console.log('  How should GuardClaw respond to risky tool calls?\n');

  const mode = await select([
    { label: 'Auto mode',     value: 'auto',         hint: 'score, warn, and flag risky calls to the agent (recommended)' },
    { label: 'Monitor only', value: 'monitor-only', hint: 'score and log only, no intervention' },
  ]);
  env = setEnvVar(env, 'GUARDCLAW_APPROVAL_MODE', mode);
  console.log(`  → ${mode}`);

  // ── Step 3: Agent connections ────────────────────────────────────────────────
  const agents = detectAgents();

  if (agents.length > 0) {
    console.log('\n── Step 4 of 4: Agent connections ──────────────────────────────────\n');
    console.log('  Detected on your system:\n');

    for (const agent of agents) {
      if (agent.installed) {
        console.log(`  ✅ ${agent.label.padEnd(14)} already connected`);
        continue;
      }

      if (agent.type === 'hook') {
        const yes = await confirm(`Connect ${agent.label}?`);
        if (yes) {
          if (agent.id === 'claude-code') installClaudeCodeHooks(GC_PORT);
          if (agent.id === 'codex') installCodexHooks();
          if (agent.id === 'gemini') installGeminiHooks();
          if (agent.id === 'cursor') installCursorHooks();
          if (agent.id === 'copilot') installClaudeCodeHooks(GC_PORT); // shares CC hooks
          console.log(`  ✅ ${agent.label} hooks installed`);
        }
      } else if (agent.type === 'ws' && agent.token) {
        const masked = agent.token.slice(0, 8) + '...';
        const yes = await confirm(`Save ${agent.label} token (${masked})?`);
        if (yes) {
          if (agent.id === 'openclaw') env = setEnvVar(env, 'OPENCLAW_TOKEN', agent.token);
          if (agent.id === 'qclaw')    env = setEnvVar(env, 'QCLAW_TOKEN', agent.token);
          console.log(`  ✅ ${agent.label} token saved`);
        }
      }
    }
  }

  writeEnvFile(env);
  markOnboardingDone();

  console.log('\n⛨ Setup complete. Config saved to:', getEnvPath());
  console.log('  To change settings later: guardclaw config\n');

  return { pendingOAuth };
}

// ─── Interactive config menu ──────────────────────────────────────────────────

async function configLLM() {
  let env = readEnvFile();
  const current = getEnvVar(env, 'SAFEGUARD_BACKEND') || 'lmstudio';

  console.log('\n── LLM Backend ─────────────────────────────────────────────────────\n');
  console.log(`  Current: ${current}\n`);

  const backends = [
    { label: 'LM Studio',  value: 'lmstudio',   hint: 'local, or any OpenAI-compatible API' },
    { label: 'MiniMax',     value: 'minimax',    hint: 'cloud, MoE models' },
    { label: 'Ollama',      value: 'ollama',     hint: 'local' },
    { label: 'Claude API',  value: 'anthropic' },
    { label: 'OpenRouter',  value: 'openrouter', hint: '400+ models' },
    { label: 'Built-in',    value: 'built-in',   hint: 'Apple Silicon MLX' },
    { label: 'Fallback',    value: 'fallback',   hint: 'rule-based only' },
  ];
  const defaultIdx = Math.max(0, backends.findIndex(b => b.value === current));
  const backend = await select(backends, { defaultIndex: defaultIdx });
  env = setEnvVar(env, 'SAFEGUARD_BACKEND', backend);

  if (backend === 'anthropic') {
    const rl = createPrompt();
    const existing = getEnvVar(env, 'ANTHROPIC_API_KEY');
    const key = await ask(rl, `  API key [${existing ? existing.slice(0,8)+'...' : 'not set'}]: `);
    rl.close();
    const resolvedKey = key || existing;
    if (key) env = setEnvVar(env, 'ANTHROPIC_API_KEY', key);
    process.stdout.write('  Fetching models...');
    const models = await fetchModels('anthropic', null, resolvedKey);
    process.stdout.write(models.length ? ` ${models.length} found\n` : ' (using defaults)\n');
    const currentModel = getEnvVar(env, 'LMSTUDIO_MODEL');
    const model = await pickModel(null, models.length ? models : KNOWN_MODELS.anthropic, currentModel, KNOWN_MODELS.anthropic[0]);
    if (model) env = setEnvVar(env, 'LMSTUDIO_MODEL', model);
  } else if (backend === 'lmstudio') {
    const rl = createPrompt();
    const existingUrl = getEnvVar(env, 'LMSTUDIO_URL') || 'http://localhost:1234/v1';
    const u = await ask(rl, `  URL [${existingUrl}]: `);
    rl.close();
    const resolvedUrl = u || existingUrl;
    if (u) env = setEnvVar(env, 'LMSTUDIO_URL', resolvedUrl);
    // API key (optional — needed for cloud OpenAI-compatible APIs like MiniMax, DeepSeek, etc.)
    const rlKey = createPrompt();
    const existingKey = getEnvVar(env, 'LMSTUDIO_API_KEY') || getEnvVar(env, 'LLM_API_KEY');
    const keyPrompt = existingKey ? `  API key [${existingKey.slice(0,8)}...] (Enter to keep, "none" to clear): ` : '  API key (optional, for cloud APIs): ';
    const apiKey = await ask(rlKey, keyPrompt);
    rlKey.close();
    if (apiKey === 'none') {
      env = setEnvVar(env, 'LMSTUDIO_API_KEY', '');
    } else if (apiKey) {
      env = setEnvVar(env, 'LMSTUDIO_API_KEY', apiKey);
    }
    const effectiveKey = (apiKey === 'none') ? null : (apiKey || existingKey || null);
    process.stdout.write('  Fetching models...');
    const models = await fetchModels('lmstudio', resolvedUrl, effectiveKey);
    process.stdout.write(models.length ? ` ${models.length} found\n` : ' (none found)\n');
    const currentModel = getEnvVar(env, 'LMSTUDIO_MODEL') || 'auto';
    if (models.length) {
      const model = await pickModel(null, models, currentModel, 'auto');
      env = setEnvVar(env, 'LMSTUDIO_MODEL', model);
    } else {
      const rl2 = createPrompt();
      const m = await ask(rl2, `  Model [${currentModel}]: `);
      rl2.close();
      if (m) env = setEnvVar(env, 'LMSTUDIO_MODEL', m);
    }
  } else if (backend === 'ollama') {
    const rl = createPrompt();
    const existingUrl = getEnvVar(env, 'OLLAMA_URL') || 'http://localhost:11434';
    const u = await ask(rl, `  URL [${existingUrl}]: `);
    rl.close();
    const resolvedUrl = u || existingUrl;
    if (u) env = setEnvVar(env, 'OLLAMA_URL', resolvedUrl);
    process.stdout.write('  Fetching models...');
    const models = await fetchModels('ollama', resolvedUrl);
    process.stdout.write(models.length ? ` ${models.length} found\n` : ' (none found)\n');
    const currentModel = getEnvVar(env, 'OLLAMA_MODEL') || 'llama3';
    if (models.length) {
      const model = await pickModel(null, models, currentModel, 'llama3');
      env = setEnvVar(env, 'OLLAMA_MODEL', model);
    } else {
      const rl2 = createPrompt();
      const m = await ask(rl2, `  Model [${currentModel}]: `);
      rl2.close();
      if (m) env = setEnvVar(env, 'OLLAMA_MODEL', m);
    }
  } else if (backend === 'minimax') {
    // MiniMax is OpenAI-compatible — uses lmstudio backend internally
    env = setEnvVar(env, 'SAFEGUARD_BACKEND', 'lmstudio');
    env = setEnvVar(env, 'LMSTUDIO_URL', 'https://api.minimaxi.chat/v1');
    const rl = createPrompt();
    const existing = getEnvVar(env, 'LMSTUDIO_API_KEY') || getEnvVar(env, 'MINIMAX_API_KEY');
    const key = await ask(rl, `  MiniMax API key [${existing ? existing.slice(0,8)+'...' : 'not set'}]: `);
    rl.close();
    if (key) env = setEnvVar(env, 'LMSTUDIO_API_KEY', key);
    const models = KNOWN_MODELS.minimax;
    const currentModel = getEnvVar(env, 'LMSTUDIO_MODEL');
    const model = await pickModel(null, models, currentModel, 'MiniMax-M2.5-highspeed');
    if (model) env = setEnvVar(env, 'LMSTUDIO_MODEL', model);
  } else if (backend === 'openrouter') {
    const rl = createPrompt();
    const existing = getEnvVar(env, 'OPENROUTER_API_KEY');
    const key = await ask(rl, `  API key [${existing ? existing.slice(0,8)+'...' : 'not set'}]: `);
    rl.close();
    const resolvedKey = key || existing;
    if (key) env = setEnvVar(env, 'OPENROUTER_API_KEY', key);
    process.stdout.write('  Fetching models...');
    const models = await fetchModels('openrouter', null, resolvedKey);
    process.stdout.write(models.length ? ` ${models.length} found\n` : ' (using defaults)\n');
    const currentModel = getEnvVar(env, 'OPENROUTER_MODEL');
    const list = models.length ? models : KNOWN_MODELS.openrouter;
    const model = await pickModel(null, list, currentModel, list[0]);
    if (model) env = setEnvVar(env, 'OPENROUTER_MODEL', model);
  } else if (backend === 'openai' || backend === 'gemini') {
    const rl = createPrompt();
    const keyName = backend === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
    const existing = getEnvVar(env, keyName);
    const key = await ask(rl, `  API key [${existing ? existing.slice(0,8)+'...' : 'not set'}]: `);
    rl.close();
    const resolvedKey = key || existing;
    if (key) env = setEnvVar(env, keyName, key);
    process.stdout.write('  Fetching models...');
    const models = await fetchModels(backend, null, resolvedKey);
    process.stdout.write(models.length ? ` ${models.length} found\n` : ' (using defaults)\n');
    const currentModel = getEnvVar(env, 'LMSTUDIO_MODEL');
    const list = models.length ? models : (KNOWN_MODELS[backend] || []);
    if (list.length) {
      const model = await pickModel(null, list, currentModel, list[0]);
      if (model) env = setEnvVar(env, 'LMSTUDIO_MODEL', model);
    }
  }

  writeEnvFile(env);

  // Try hot-reload via the server API
  await tryHotReload('llm', {
    backend,
    lmstudioUrl: getEnvVar(env, 'LMSTUDIO_URL'),
    lmstudioModel: getEnvVar(env, 'LMSTUDIO_MODEL'),
    lmstudioApiKey: getEnvVar(env, 'LMSTUDIO_API_KEY'),
    ollamaUrl: getEnvVar(env, 'OLLAMA_URL'),
    ollamaModel: getEnvVar(env, 'OLLAMA_MODEL'),
    openrouterApiKey: getEnvVar(env, 'OPENROUTER_API_KEY'),
    openrouterModel: getEnvVar(env, 'OPENROUTER_MODEL'),
  }, `Backend set to: ${backend}`);
}

async function configMode() {
  let env = readEnvFile();
  const current = getEnvVar(env, 'GUARDCLAW_APPROVAL_MODE') || 'auto';

  console.log('\n── Approval Mode ───────────────────────────────────────────────────\n');
  console.log(`  Current: ${current}\n`);

  const modes = [
    { label: 'Auto',         value: 'auto',         hint: 'auto-allow safe, auto-block dangerous' },
    { label: 'Prompt',       value: 'prompt',       hint: 'ask for medium-risk commands' },
    { label: 'Monitor only', value: 'monitor-only', hint: 'never block, just log' },
  ];
  const defaultIdx = Math.max(0, modes.findIndex(m => m.value === current));
  const mode = await select(modes, { defaultIndex: defaultIdx });

  writeEnvFile(setEnvVar(env, 'GUARDCLAW_APPROVAL_MODE', mode));
  await tryHotReload(null, null, `Mode set to: ${mode}`);
}

async function configThresholds() {
  const rl = createPrompt();
  let env = readEnvFile();

  const allow = getEnvVar(env, 'GUARDCLAW_AUTO_ALLOW_THRESHOLD') || '6';
  const askT  = getEnvVar(env, 'GUARDCLAW_ASK_THRESHOLD')        || '8';
  const block = getEnvVar(env, 'GUARDCLAW_AUTO_BLOCK_THRESHOLD') || '9';

  console.log('\n── Risk Thresholds  (scale 1–10) ───────────────────────────────────\n');
  console.log('  score ≤ allow           → auto-allow');
  console.log('  allow < score ≤ ask     → ask user (prompt mode only)');
  console.log('  score ≥ block           → auto-block\n');

  const na = await ask(rl, `Auto-allow threshold [${allow}]: `);
  const nb = await ask(rl, `Ask threshold        [${askT}]: `);
  const nc = await ask(rl, `Auto-block threshold [${block}]: `);

  rl.close();
  env = setEnvVar(env, 'GUARDCLAW_AUTO_ALLOW_THRESHOLD', na || allow);
  env = setEnvVar(env, 'GUARDCLAW_ASK_THRESHOLD',        nb || askT);
  env = setEnvVar(env, 'GUARDCLAW_AUTO_BLOCK_THRESHOLD', nc || block);
  writeEnvFile(env);
  await tryHotReload(null, null, 'Thresholds updated');
}

async function configAgentsInteractive() {
  const agents = detectAgents();

  if (agents.length === 0) {
    console.log('\n  No supported agents detected on this system.\n');
    return;
  }

  let env = readEnvFile();

  console.log('\n── Agent Connections ───────────────────────────────────────────────\n');

  for (const agent of agents) {
    const status = agent.installed ? '✅ connected' : '⚪ not connected';
    console.log(`  ${agent.label.padEnd(14)} ${status}`);
  }
  console.log('');

  for (const agent of agents) {
    if (agent.type === 'hook') {
      if (agent.installed) {
        const yes = await confirm(`Remove ${agent.label} hooks?`, { defaultYes: false });
        if (yes) {
          if (agent.id === 'claude-code') uninstallClaudeCodeHooks();
          if (agent.id === 'codex') uninstallCodexHooks();
          console.log(`  ✅ ${agent.label} hooks removed`);
        }
      } else {
        const yes = await confirm(`Install ${agent.label} hooks?`);
        if (yes) {
          if (agent.id === 'claude-code') installClaudeCodeHooks(GC_PORT);
          if (agent.id === 'codex') installCodexHooks();
          console.log(`  ✅ ${agent.label} hooks installed`);
        }
      }
    } else if (agent.type === 'ws' && agent.token) {
      if (!agent.installed) {
        const masked = agent.token.slice(0, 8) + '...';
        const yes = await confirm(`Save ${agent.label} token (${masked})?`);
        if (yes) {
          if (agent.id === 'openclaw') env = setEnvVar(env, 'OPENCLAW_TOKEN', agent.token);
          if (agent.id === 'qclaw')    env = setEnvVar(env, 'QCLAW_TOKEN', agent.token);
          console.log(`  ✅ ${agent.label} token saved`);
        }
      }
    }
  }

  writeEnvFile(env);
  console.log('');
}

async function configEvalMode() {
  console.log('\n── Evaluation Mode ─────────────────────────────────────────────────\n');

  let currentMode = 'mixed';
  try {
    const cfg = await gcApi('/api/config/cloud-judge', 'GET', undefined, { silent: true });
    currentMode = cfg?.judgeMode || 'mixed';
    console.log(`  Current: ${currentMode}\n`);
  } catch {
    // Fall back to persisted config if server isn't up.
    try {
      const persisted = JSON.parse(fs.readFileSync(CLOUD_JUDGE_CONFIG_FILE, 'utf8'));
      if (persisted.judgeMode) currentMode = persisted.judgeMode;
    } catch {}
    console.log(`  Current: ${currentMode} (server not running)\n`);
  }

  const modes = [
    { label: 'Local only',  value: 'local-only',  hint: 'private, fast, single LLM' },
    { label: 'Mixed',       value: 'mixed',       hint: 'local + cloud escalation for risky calls' },
    { label: 'Cloud only',  value: 'cloud-only',  hint: 'all evaluation via cloud API' },
  ];
  const defaultIdx = Math.max(0, modes.findIndex(m => m.value === currentMode));
  const mode = await select(modes, { defaultIndex: defaultIdx });

  const enabled = mode !== 'local-only';
  try {
    await gcApi('/api/config/cloud-judge', 'POST', { enabled, judgeMode: mode }, { silent: true });
    console.log(`\n✅ Evaluation mode set to: ${mode}\n`);
  } catch {
    writePersistedCloudJudgeConfig({ enabled, judgeMode: mode });
    console.log(`\n✅ Evaluation mode saved: ${mode}  (will activate on next start)\n`);
  }
}

async function runInteractiveConfig() {
  console.log('\n⚙️  GuardClaw Configuration\n');

  const choice = await select([
    { label: 'Evaluation mode',    value: 'eval',       hint: 'local / mixed / cloud' },
    { label: 'LLM backend',       value: 'llm' },
    { label: 'Approval mode',     value: 'mode' },
    { label: 'Risk thresholds',   value: 'thresholds' },
    { label: 'Agent connections',  value: 'agents' },
    { label: 'Show all settings',  value: 'show' },
    { label: 'Re-run setup wizard', value: 'wizard' },
  ]);

  switch (choice) {
    case 'eval': await configEvalMode(); break;
    case 'llm': await configLLM(); break;
    case 'mode': await configMode(); break;
    case 'thresholds': await configThresholds(); break;
    case 'agents': await configAgentsInteractive(); break;
    case 'show': configShow(); break;
    case 'wizard': await runOnboarding(); break;
  }
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
🛡️  GuardClaw - AI Agent Safety Monitor

Usage:
  guardclaw status                   Server + agent connection overview
  guardclaw stats                    Evaluation statistics
  guardclaw history [n]              Recent evaluations (default: 20)
  guardclaw model [load|unload]      LLM model management
  guardclaw blocking [on|off]        Show or toggle blocking mode
  guardclaw check <command>          Manually risk-score a command
  guardclaw approvals                Show pending approvals
  guardclaw memory                   Show learned patterns

  guardclaw start [options]          Start the GuardClaw server
  guardclaw stop                     Stop the GuardClaw server
  guardclaw restart [options]        Restart the GuardClaw server
  guardclaw setup                    Run the setup wizard
  guardclaw config [command]         Configuration (interactive menu if no command)
  guardclaw hooks [command]          Manage Claude Code / Codex hook integrations
  guardclaw plugin [command]         Manage OpenClaw interceptor plugin
  guardclaw update                   Update GuardClaw
  guardclaw version / help

Config Commands:
  guardclaw config                   Interactive menu
  guardclaw config show              Show all settings
  guardclaw config set <KEY> <VAL>   Set any variable
  guardclaw config eval              Change evaluation mode (local/mixed/cloud)
  guardclaw config llm               Change LLM backend
  guardclaw config mode              Change approval mode
  guardclaw config thresholds        Change risk thresholds
  guardclaw config agents            Manage agent connections
  guardclaw config setup             Re-run setup wizard (alias: guardclaw setup)
  guardclaw config set-token <tok>   Set OpenClaw token
  guardclaw config detect-token      Auto-detect OpenClaw token

Hooks Commands:
  guardclaw hooks                    Show hook installation status
  guardclaw hooks install [agent]    Install hooks (claude-code | codex | all)
  guardclaw hooks uninstall [agent]  Remove hooks

Plugin Commands:
  guardclaw plugin install           Install OpenClaw interceptor plugin
  guardclaw plugin uninstall
  guardclaw plugin status

Start Options:
  --port <port>              Server port (default: 3002)
  --no-open                  Don't open browser
  --no-onboarding            Skip onboarding check (for CI/scripts)
  `);
}

function showVersion() {
  const pkg = JSON.parse(fs.readFileSync(join(rootDir, 'package.json'), 'utf8'));
  console.log(`GuardClaw v${pkg.version}`);
}

// ─── Stop server ──────────────────────────────────────────────────────────────

function stopServer() {
  console.log('🛑 Stopping GuardClaw...\n');
  const pids = new Set();

  // Primary: inspect process table directly (case-insensitive "guardclaw").
  try {
    const out = execSync('ps ax -o pid= -o command=', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    for (const line of out.split('\n').filter(Boolean)) {
      const m = line.match(/^\s*(\d+)\s+(.+)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      const cmd = m[2];
      if (Number.isNaN(pid)) continue;
      if (!cmd.includes('server/index.js')) continue;
      if (/guardclaw/i.test(cmd) || cmd.includes(`${rootDir}/server/index.js`)) {
        pids.add(pid);
        continue;
      }
      // Relative path (e.g. `node server/index.js`) — resolve the process
      // cwd and check whether it lives under the guardclaw repo.
      try {
        const cwdLine = execSync(`lsof -p ${pid} -a -d cwd -Fn`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).split('\n').find(l => l.startsWith('n'));
        const cwd = cwdLine ? cwdLine.slice(1) : '';
        if (cwd && (cwd === rootDir || cwd.startsWith(rootDir + '/'))) pids.add(pid);
      } catch {}
    }
  } catch {}

  // Fallback: find listener on GuardClaw port and validate command.
  // A process listening on GC_PORT running `server/index.js` is GuardClaw —
  // no need for extra name checks that miss foreground launches via
  // relative paths (e.g. `node server/index.js` from the repo root).
  try {
    const out = execSync(`lsof -ti tcp:${GC_PORT} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    for (const rawPid of out.split('\n').filter(Boolean)) {
      const pid = Number(rawPid.trim());
      if (Number.isNaN(pid)) continue;
      try {
        const cmd = execSync(`ps -p ${pid} -o command=`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        if (cmd.includes('server/index.js')) pids.add(pid);
      } catch {}
    }
  } catch {}

  if (!pids.size) {
    console.log('ℹ️  GuardClaw is not running.');
    return;
  }

  let stopped = 0;
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
      stopped++;
      console.log(`✅ Stopped PID ${pid}`);
    } catch (e) {
      if (e.code !== 'ESRCH') console.error(`⚠️  Could not stop ${pid}:`, e.message);
    }
  }
  if (stopped) console.log(`\n✅ Stopped ${stopped} process(es)`);
}

// ─── Config commands ──────────────────────────────────────────────────────────

async function configSetDirect() {
  const key = process.argv[4], value = process.argv[5];
  if (!key || !value) {
    console.error('Usage: guardclaw config set <KEY> <VALUE>');
    process.exit(1);
  }
  const env = setEnvVar(readEnvFile(), key, value);
  writeEnvFile(env);
  const display = (key.includes('KEY') || key.includes('TOKEN')) && value.length > 8
    ? value.slice(0, 8) + '...' : value;

  // Try hot-reload if the key is LLM-related and server is running
  const llmKeys = new Set(['SAFEGUARD_BACKEND', 'LMSTUDIO_URL', 'LMSTUDIO_MODEL', 'LMSTUDIO_API_KEY', 'LLM_API_KEY', 'OLLAMA_URL', 'OLLAMA_MODEL', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL']);
  if (llmKeys.has(key) && isServerRunning()) {
    try {
      await gcApi('/api/config/llm', 'POST', {
        backend: getEnvVar(env, 'SAFEGUARD_BACKEND') || 'lmstudio',
        lmstudioUrl: getEnvVar(env, 'LMSTUDIO_URL'),
        lmstudioModel: getEnvVar(env, 'LMSTUDIO_MODEL'),
        lmstudioApiKey: getEnvVar(env, 'LMSTUDIO_API_KEY'),
        ollamaUrl: getEnvVar(env, 'OLLAMA_URL'),
        ollamaModel: getEnvVar(env, 'OLLAMA_MODEL'),
      }, { silent: true });
      console.log(`✅ ${key} = ${display} — applied`);
      return;
    } catch {}
  }
  console.log(`✅ ${key} = ${display}`);
}

function configSetToken() {
  const token = process.argv[4];
  if (!token) { console.error('Usage: guardclaw config set-token <token>'); process.exit(1); }
  writeEnvFile(setEnvVar(readEnvFile(), 'OPENCLAW_TOKEN', token));
  console.log('✅ OPENCLAW_TOKEN saved  (restart to apply)\n');
}

function configGetToken() {
  const token = getEnvVar(readEnvFile(), 'OPENCLAW_TOKEN');
  if (token) {
    const m = token.length > 16 ? token.slice(0,8)+'...'+token.slice(-4) : token;
    console.log(`🔑 OPENCLAW_TOKEN: ${m}\n   Full: ${token}`);
  } else {
    console.log('ℹ️  No OPENCLAW_TOKEN set.\n   Set: guardclaw config set-token <token>\n   Auto-detect: guardclaw config detect-token');
  }
}

function configDetectToken() {
  const save = process.argv[4] === '--save' || process.argv[4] === '-s';
  const configPath = join(os.homedir(), '.openclaw', 'openclaw.json');
  if (!fs.existsSync(configPath)) { console.error('❌ OpenClaw config not found at:', configPath); process.exit(1); }
  try {
    const token = JSON.parse(fs.readFileSync(configPath, 'utf8'))?.gateway?.auth?.token;
    if (!token) { console.error('❌ Token not found in OpenClaw config'); process.exit(1); }
    console.log(`✅ Found: ${token.slice(0,16)}...${token.slice(-8)}`);
    if (save) {
      writeEnvFile(setEnvVar(readEnvFile(), 'OPENCLAW_TOKEN', token));
      console.log('✅ Saved to .env  (restart to apply)\n');
    } else {
      console.log(`   To save: guardclaw config set-token ${token}`);
      console.log('   Or:      guardclaw config detect-token --save');
    }
  } catch (e) { console.error('❌', e.message); process.exit(1); }
}

function configShow() {
  const envPath = getEnvPath();
  if (!fs.existsSync(envPath)) {
    console.log('ℹ️  No .env file found.\n   Run: guardclaw config setup');
    return;
  }

  const env = readEnvFile();
  console.log('⚙️  GuardClaw Configuration\n');
  console.log(`📝 ${envPath}\n`);

  const sections = [
    { title: 'LLM Backend', vars: [
      ['SAFEGUARD_BACKEND',   'Backend (lmstudio/ollama/anthropic/openrouter/built-in/fallback)'],
      ['LMSTUDIO_URL',        'LM Studio / OpenAI-compat URL'],
      ['LMSTUDIO_MODEL',      'LM Studio / OpenAI-compat model'],
      ['LMSTUDIO_API_KEY',    'LM Studio / OpenAI-compat API key'],
      ['OLLAMA_URL',          'Ollama URL'],
      ['OLLAMA_MODEL',        'Ollama model'],
      ['ANTHROPIC_API_KEY',   'Anthropic API key'],
      ['OPENROUTER_API_KEY',  'OpenRouter API key'],
      ['OPENROUTER_MODEL',    'OpenRouter model'],
      ['OPENAI_API_KEY',      'OpenAI API key'],
      ['GEMINI_API_KEY',      'Google Gemini API key'],
      ['KIMI_API_KEY',        'Kimi (Moonshot) API key'],
      ['MINIMAX_API_KEY',     'MiniMax API key'],
    ]},
    { title: 'Cloud Judge', vars: [
      ['CLOUD_JUDGE_ENABLED',  'Cloud judge on/off'],
      ['CLOUD_JUDGE_MODE',     'Mode (local-only/mixed/cloud-only)'],
      ['CLOUD_JUDGE_PROVIDER', 'Provider (claude/openai-codex/minimax/kimi/openrouter/gemini/openai)'],
    ]},
    { title: 'Approval Policy', vars: [
      ['GUARDCLAW_APPROVAL_MODE',         'Mode (auto/prompt/monitor-only)'],
      ['GUARDCLAW_AUTO_ALLOW_THRESHOLD',  'Auto-allow threshold (≤)'],
      ['GUARDCLAW_ASK_THRESHOLD',         'Ask threshold (≤)'],
      ['GUARDCLAW_AUTO_BLOCK_THRESHOLD',  'Auto-block threshold (≥)'],
    ]},
    { title: 'Connections', vars: [
      ['BACKEND',        'Gateway mode (auto/openclaw/qclaw/nanobot)'],
      ['OPENCLAW_TOKEN', 'OpenClaw token'],
      ['QCLAW_TOKEN',    'Qclaw token'],
      ['PORT',           'Server port'],
    ]},
    { title: 'Notifications', vars: [
      ['TELEGRAM_BOT_TOKEN',  'Telegram bot token'],
      ['TELEGRAM_CHAT_ID',    'Telegram chat ID'],
      ['DISCORD_WEBHOOK_URL', 'Discord webhook URL'],
    ]},
  ];

  for (const { title, vars } of sections) {
    console.log(`  ${title}`);
    for (const [key, desc] of vars) {
      let val = getEnvVar(env, key);
      if (val) {
        if ((key.includes('KEY') || key.includes('TOKEN')) && val.length > 8)
          val = val.slice(0,8)+'...'+val.slice(-4);
        console.log(`    ✅ ${key.padEnd(32)} ${val}`);
      } else {
        console.log(`    ⚪ ${key.padEnd(32)} — ${desc}`);
      }
    }
    console.log('');
  }

  // Agents section — filesystem state, not .env
  const agents = detectAgents();
  if (agents.length > 0) {
    console.log('  Agent Hooks');
    for (const a of agents) {
      const icon = a.installed ? '✅' : '⚪';
      const note = a.installed ? 'connected' : 'not connected';
      console.log(`    ${icon} ${a.label.padEnd(16)} ${note}`);
    }
    console.log('');
  }

  console.log('  guardclaw config          → interactive menu');
  console.log('  guardclaw config set K V  → set a variable directly\n');
}

async function handleConfigCommand() {
  switch (process.argv[3]) {
    case undefined:
    case 'menu':       await runInteractiveConfig(); break;
    case 'setup':      await runOnboarding(); break;
    case 'eval':
    case 'evaluation': await configEvalMode(); break;
    case 'llm':        await configLLM(); break;
    case 'mode':       await configMode(); break;
    case 'thresholds': await configThresholds(); break;
    case 'agents':     await configAgentsInteractive(); break;
    case 'set':        await configSetDirect(); break;
    case 'show':       configShow(); break;
    case 'set-token':  configSetToken(); break;
    case 'get-token':  configGetToken(); break;
    case 'detect-token': configDetectToken(); break;
    default:
      console.error(`Unknown config command: ${process.argv[3]}`);
      console.log('Run "guardclaw help" for usage.');
      process.exit(1);
  }
}

// ─── Hooks command ────────────────────────────────────────────────────────────

async function cmdHooks() {
  const sub    = process.argv[3];  // install | uninstall | undefined
  const target = process.argv[4];  // claude-code | codex | all | undefined

  const SUPPORTED = [
    { id: 'claude-code', label: 'Claude Code', available: () => fs.existsSync(join(os.homedir(), '.claude')), install: () => installClaudeCodeHooks(GC_PORT), uninstall: uninstallClaudeCodeHooks, installed: isClaudeCodeHooksInstalled },
    { id: 'codex',       label: 'Codex',       available: () => fs.existsSync(join(os.homedir(), '.codex')),  install: installCodexHooks, uninstall: uninstallCodexHooks, installed: isCodexHooksInstalled },
  ];

  if (!sub) {
    console.log('\n⛨  Hook Integrations\n');
    for (const a of SUPPORTED) {
      const avail = a.available();
      const inst  = avail && a.installed();
      const icon  = inst ? '✅' : avail ? '⚪' : '—';
      const note  = inst ? 'installed' : avail ? 'not installed' : 'not detected';
      console.log(`  ${icon} ${a.label.padEnd(14)} ${note}`);
    }
    console.log('\n  guardclaw hooks install [claude-code|codex|all]');
    console.log('  guardclaw hooks uninstall [claude-code|codex|all]\n');
    return;
  }

  const targets = (!target || target === 'all')
    ? SUPPORTED.filter(a => a.available())
    : SUPPORTED.filter(a => a.id === target);

  if (!targets.length) {
    console.error(target ? `❌ Unknown agent: ${target}` : '❌ No supported agents detected.');
    process.exit(1);
  }

  for (const a of targets) {
    if (sub === 'install') {
      a.install();
      console.log(`✅ ${a.label} hooks installed  (${a.id === 'claude-code' ? CLAUDE_SETTINGS : CODEX_HOOKS_FILE})`);
    } else if (sub === 'uninstall') {
      a.uninstall();
      console.log(`✅ ${a.label} hooks removed`);
    } else {
      console.error(`Unknown hooks command: ${sub}`);
      process.exit(1);
    }
  }
  console.log('');
}

// ─── Plugin command ───────────────────────────────────────────────────────────

function handlePluginCommand() {
  const subcommand = process.argv[3];
  const openclawConfigPath = join(os.homedir(), '.openclaw', 'openclaw.json');
  const pluginSrcDir = join(rootDir, 'plugin', 'guardclaw-interceptor');
  const pluginInstallDir = join(os.homedir(), '.openclaw', 'plugins', 'guardclaw-interceptor');
  const pluginId = 'guardclaw-interceptor';

  function readOCConfig() {
    if (!fs.existsSync(openclawConfigPath))
      throw new Error(`OpenClaw config not found at ${openclawConfigPath}`);
    return JSON.parse(fs.readFileSync(openclawConfigPath, 'utf8'));
  }
  function saveOCConfig(cfg) { fs.writeFileSync(openclawConfigPath, JSON.stringify(cfg, null, 2)); }
  function isInstalled(cfg) { return (cfg?.plugins?.load?.paths || []).includes(pluginInstallDir); }

  switch (subcommand) {
    case 'install': {
      console.log('📦 Installing GuardClaw interceptor plugin...\n');
      if (!fs.existsSync(pluginSrcDir)) { console.error(`❌ Plugin source not found: ${pluginSrcDir}`); process.exit(1); }

      fs.mkdirSync(pluginInstallDir, { recursive: true });
      for (const f of fs.readdirSync(pluginSrcDir))
        fs.copyFileSync(join(pluginSrcDir, f), join(pluginInstallDir, f));
      console.log(`✅ Plugin files copied to: ${pluginInstallDir}`);

      let cfg;
      try { cfg = readOCConfig(); } catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }

      if (!cfg.plugins) cfg.plugins = {};
      if (!cfg.plugins.load) cfg.plugins.load = {};
      if (!cfg.plugins.load.paths) cfg.plugins.load.paths = [];
      if (!cfg.plugins.entries) cfg.plugins.entries = {};

      cfg.plugins.load.paths = cfg.plugins.load.paths.filter(p => !p.includes('guardclaw-interceptor') || p === pluginInstallDir);
      if (!cfg.plugins.load.paths.includes(pluginInstallDir)) cfg.plugins.load.paths.push(pluginInstallDir);
      cfg.plugins.entries[pluginId] = { enabled: true };

      saveOCConfig(cfg);
      console.log(`✅ Plugin enabled in OpenClaw config`);
      console.log('\n⚠️  Restart OpenClaw Gateway: openclaw gateway restart\n');
      break;
    }

    case 'uninstall': {
      console.log('🗑️  Uninstalling...\n');
      let cfg;
      try { cfg = readOCConfig(); } catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }

      if (cfg?.plugins?.load?.paths)
        cfg.plugins.load.paths = cfg.plugins.load.paths.filter(p => p !== pluginInstallDir);
      if (cfg?.plugins?.entries) delete cfg.plugins.entries[pluginId];
      saveOCConfig(cfg);

      if (fs.existsSync(pluginInstallDir)) fs.rmSync(pluginInstallDir, { recursive: true });
      console.log('✅ Plugin removed\n⚠️  Restart OpenClaw Gateway: openclaw gateway restart\n');
      break;
    }

    case 'status': {
      let cfg;
      try { cfg = readOCConfig(); } catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }

      const installed = isInstalled(cfg);
      const enabled = cfg?.plugins?.entries?.[pluginId]?.enabled;
      const filesExist = fs.existsSync(pluginInstallDir);

      console.log('🔌 GuardClaw Interceptor Plugin\n');
      console.log(`  Files    : ${filesExist ? '✅' : '❌'}  ${pluginInstallDir}`);
      console.log(`  Registered: ${installed ? '✅' : '❌'}`);
      console.log(`  Enabled  : ${enabled ? '✅' : '❌'}`);
      if (!installed || !filesExist) console.log('\n  → Run: guardclaw plugin install');
      else if (!enabled) console.log('\n  → Enable via Dashboard (🛡️ Blocking toggle)');
      else console.log('\n  → Active. Restart gateway if recently changed.');
      break;
    }

    default:
      console.log('Usage: guardclaw plugin install | uninstall | status');
      process.exit(1);
  }
}

// ─── Update ───────────────────────────────────────────────────────────────────

function updateGuardClaw() {
  // Check current vs latest version
  let currentVer, latestVer;
  try {
    const pkg = JSON.parse(fs.readFileSync(join(rootDir, 'package.json'), 'utf8'));
    currentVer = pkg.version;
  } catch { currentVer = '?'; }
  try {
    latestVer = execSync('npm view guardclaw version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch { latestVer = null; }

  if (latestVer && currentVer === latestVer) {
    console.log(`✅ Already on latest version (${currentVer})\n`);
    return;
  }

  console.log(`🔄 Updating GuardClaw...${latestVer ? `  ${currentVer} → ${latestVer}` : ''}\n`);

  // Stop running server first
  const wasRunning = isServerRunning();
  if (wasRunning) {
    console.log('🛑 Stopping server before update...');
    stopServer();
  }

  const child = spawn('npm', ['install', '-g', 'guardclaw@latest'], { stdio: 'inherit', shell: true });
  child.on('exit', async (code) => {
    if (code !== 0) {
      console.error(`\n❌ Update failed (code ${code})`);
      process.exit(code);
    }
    console.log('\n✅ Updated successfully');
    if (wasRunning) {
      console.log('🔄 Restarting server...\n');
      await startServer();
    } else {
      console.log('');
    }
  });
  child.on('error', e => { console.error('❌', e.message); process.exit(1); });
}

// ─── Browser ──────────────────────────────────────────────────────────────────

function openBrowser(url) {
  const p = os.platform();
  const cmd = p === 'darwin' ? `open "${url}"` : p === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
  spawn(cmd, { shell: true, stdio: 'ignore' });
}

// ─── Start server ─────────────────────────────────────────────────────────────

async function startServer() {
  const args = process.argv.slice(3);
  const env = { ...process.env };
  let noOpen = false, noOnboarding = false, foreground = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':           env.PORT = args[++i]; break;
      case '--openclaw-url':
      case '--clawdbot-url':   env.OPENCLAW_URL = args[++i]; break;
      case '--openclaw-token':
      case '--clawdbot-token': env.OPENCLAW_TOKEN = args[++i]; break;
      case '--anthropic-key':  env.ANTHROPIC_API_KEY = args[++i]; break;
      case '--no-open':        noOpen = true; break;
      case '--no-onboarding':  noOnboarding = true; break;
      case '-f':
      case '--foreground':     foreground = true; break;
    }
  }

  // Sync hook scripts to ~/.guardclaw/hooks/ (survives npm updates)
  syncHookScripts();

  let onboardingResult = null;
  if (!noOnboarding && !isOnboardingDone() && process.stdin.isTTY) {
    onboardingResult = await runOnboarding();
  }

  // Resolve the actual port the server will listen on. Order:
  //   1. --port flag (already in env.PORT)
  //   2. PORT in user's .env (the server reads this via dotenv, but the CLI
  //      needs to know it too so the printed dashboard URL matches reality)
  //   3. inherited process.env.PORT
  //   4. default 3002
  let port = env.PORT;
  if (!port) {
    const fileEnv = readEnvFile();
    const envPort = getEnvVar(fileEnv, 'PORT');
    if (envPort) port = envPort;
  }
  port = port || 3002;
  const url  = `http://localhost:${port}`;

  console.log('🛡️  Starting GuardClaw...');
  console.log(`🌐 Dashboard: ${url}\n`);

  // Spawn the server in the user's current working directory, NOT the
  // package install directory. This ensures:
  //   • dotenv reads `<user-cwd>/.env`, so per-project config works
  //   • getDataDir() resolves to `<user-cwd>/.guardclaw`, so events.db /
  //     memory.db are project-local instead of leaking into the global npm
  //     install directory (which is often non-writable for `npm i -g`).
  if (foreground) {
    const child = spawn('node', [join(rootDir, 'server', 'index.js')], {
      stdio: 'inherit', env, cwd: process.cwd(),
    });

    if (!noOpen) setTimeout(() => { openBrowser(url); }, 2000);

    // Trigger pending OAuth after server is ready
    if (onboardingResult?.pendingOAuth) {
      setTimeout(async () => {
        try {
          console.log(`\n⛨ Starting OAuth login for ${onboardingResult.pendingOAuth}...`);
          await gcApi(`/api/config/cloud-judge/oauth/${onboardingResult.pendingOAuth}`, 'POST');
        } catch { console.log('  (OAuth can be started later from Settings dashboard)'); }
      }, 2000);
    }

    child.on('error', e => { console.error('❌ Failed to start:', e.message); process.exit(1); });
    child.on('exit', (code, signal) => {
      if (code === 0 || code === null) return;
      console.error(`❌ Exited with code ${code}${signal ? ` (signal ${signal})` : ''}`);
      process.exit(code);
    });
    process.on('SIGINT', () => { console.log('\n👋 Shutting down...'); child.kill('SIGINT'); });
    return;
  }

  // Default: daemonize so Ctrl-C in this terminal does NOT stop the server.
  // Use `guardclaw stop` to terminate.
  const logDir = join(process.cwd(), '.guardclaw');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch {}
  const logPath = join(logDir, 'server.log');
  const out = fs.openSync(logPath, 'a');
  const errOut = fs.openSync(logPath, 'a');

  const child = spawn('node', [join(rootDir, 'server', 'index.js')], {
    stdio: ['ignore', out, errOut],
    env,
    cwd: process.cwd(),
    detached: true,
  });
  child.on('error', e => { console.error('❌ Failed to start:', e.message); process.exit(1); });
  child.unref();

  console.log(`✅ GuardClaw running in background (PID ${child.pid})`);
  console.log(`📜 Logs: ${logPath}`);
  console.log(`🛑 Stop with: guardclaw stop`);

  if (onboardingResult?.pendingOAuth) {
    // Wait for server, trigger OAuth, then exit
    setTimeout(async () => {
      try {
        console.log(`\n⛨ Starting OAuth login for ${onboardingResult.pendingOAuth}...`);
        await gcApi(`/api/config/cloud-judge/oauth/${onboardingResult.pendingOAuth}`, 'POST');
      } catch { console.log('  (OAuth can be started later from Settings dashboard)'); }
      if (!noOpen) openBrowser(url);
      process.exit(0);
    }, 2000);
  } else if (!noOpen) {
    setTimeout(() => { openBrowser(url); process.exit(0); }, 2000);
  } else {
    process.exit(0);
  }
}

async function restartServer() {
  stopServer();
  // Give the OS a brief moment to release sockets/PIDs before spawning again.
  await new Promise(resolve => setTimeout(resolve, 300));
  await startServer();
}

// ─── Query commands ───────────────────────────────────────────────────────────

async function cmdStatus() {
  const [health, status] = await Promise.all([gcApi('/api/health'), gcApi('/api/status')]);

  console.log('⛨  GuardClaw Status\n');
  console.log(`  Running:     ✅ Yes  (PID ${health.pid})`);
  console.log(`  Blocking:    ${health.blockingEnabled ? '🔴 ON' : '🟢 OFF (monitor only)'}`);
  console.log(`  Fail-closed: ${health.failClosed ? 'Yes' : 'No'}`);
  console.log(`  LLM:         ${status.safeguardBackend || 'unknown'}${status.llmStatus?.model ? ` (${status.llmStatus.model})` : ''}`);

  if (status.backends) {
    console.log('\n  Agent Connections');
    for (const [id, b] of Object.entries(status.backends)) {
      const icon   = b.connected ? '✅' : '⚪';
      const type   = b.type === 'http-hook' ? 'hook' : 'ws';
      const counts = status.backendCounts?.[id];
      const total  = counts?.total ?? 0;
      console.log(`  ${icon} ${(b.label || id).padEnd(16)} [${type}]${total > 0 ? `  ${total} events` : ''}`);
    }
  }

  if (status.eventCounts) {
    const ec = status.eventCounts;
    // The server returns null for individual buckets when no events exist;
    // coerce to 0 instead of printing literal "null".
    console.log(`\n  Events: ${ec.total ?? 0} total  🟢 ${ec.safe ?? 0} safe  🟡 ${ec.warn ?? 0} warn  🔴 ${ec.blocked ?? 0} blocked`);
  }
  if (status.safeguardCache) {
    const c = status.safeguardCache;
    console.log(`  Cache:  ${c.hits ?? 0} hits / ${c.misses ?? 0} misses / ${c.aiCalls ?? 0} AI calls`);
  }
}

async function cmdStats() {
  const [memStats, status] = await Promise.all([gcApi('/api/memory/stats'), gcApi('/api/status')]);

  console.log('⛨  Statistics\n');
  if (memStats) {
    console.log(`  Decisions:  ${memStats.totalDecisions ?? 0}`);
    console.log(`  Patterns:   ${memStats.totalPatterns ?? 0}`);
    if (memStats.byDecision) {
      const d = memStats.byDecision;
      console.log(`  ├─ Approved: ${d.approve ?? 0}  Denied: ${d.deny ?? 0}  Auto: ${d.auto ?? 0}`);
    }
  }
  if (status.safeguardCache) {
    const c = status.safeguardCache;
    console.log(`\n  Cache hits: ${c.hits ?? 0} / misses: ${c.misses ?? 0} / AI calls: ${c.aiCalls ?? 0}`);
  }
}

async function cmdHistory() {
  const raw = process.argv[3];
  let limit = 20;
  if (raw !== undefined) {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n <= 0) {
      console.error(`❌ Invalid limit: "${raw}" (must be a positive integer)`);
      console.error('   Usage: guardclaw history [n]');
      process.exit(1);
    }
    limit = Math.min(n, 1000);
  }
  const data = await gcApi(`/api/events/history?limit=${limit}&filter=tool`);
  const events = data.events || data || [];

  console.log(`⛨  Recent Evaluations (last ${limit})\n`);
  if (!events.length) { console.log('  No evaluations yet.'); return; }

  for (const ev of events) {
    const ts      = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : '';
    const tool    = ev.toolName || ev.tool || '?';
    const score   = ev.riskScore ?? ev.score ?? '?';
    const verdict = ev.verdict || ev.category || '';
    const cmd     = (ev.command || ev.summary || '').substring(0, 60);
    const icon    = score <= 3 ? '🟢' : score <= 6 ? '🟡' : score <= 8 ? '🟠' : '🔴';
    console.log(`  ${ts}  ${icon} ${String(score).padStart(2)}/10  ${verdict.padEnd(7)}  ${tool}: ${cmd}`);
  }
}

async function cmdModel() {
  const sub = process.argv[3];

  if (sub === 'load') {
    const id = process.argv[4];
    if (!id) { console.error('Usage: guardclaw model load <model-id>'); process.exit(1); }
    const r = await gcApi(`/api/models/${id}/load`, 'POST');
    console.log(`✅ ${r.status || 'done'}: ${r.modelId || id}`);
    return;
  }
  if (sub === 'unload') {
    await gcApi('/api/models/unload', 'POST');
    console.log('✅ Model unloaded');
    return;
  }

  const [models, engineStatus] = await Promise.all([gcApi('/api/models'), gcApi('/api/models/status')]);
  console.log('⛨  LLM Models\n');
  if (engineStatus) {
    console.log(`  Engine: ${engineStatus.status || 'unknown'}${engineStatus.loadedModel ? `  (${engineStatus.loadedModel})` : ''}\n`);
  }
  if (models?.models) {
    for (const m of models.models) {
      const s = m.loaded ? '🟢 loaded' : m.downloaded ? '⚪ ready' : '⬇️  not downloaded';
      console.log(`  ${m.id.padEnd(20)} ${s}  ${m.size || ''}`);
      if (m.description) console.log(`    ${m.description}`);
    }
  }
}

async function cmdBlocking() {
  const action = process.argv[3];
  if (action === 'on' || action === 'off') {
    await gcApi('/api/blocking/toggle', 'POST', { enabled: action === 'on' });
    console.log(`⛨  Blocking ${action === 'on' ? '🔴 ENABLED' : '🟢 DISABLED'}`);
    return;
  }
  if (action !== undefined && action !== 'status') {
    console.error(`❌ Unknown blocking action: "${action}"`);
    console.error('   Usage: guardclaw blocking [on|off|status]');
    process.exit(1);
  }
  const data = await gcApi('/api/blocking/status');
  console.log('⛨  Blocking\n');
  console.log(`  Enabled: ${data.enabled ? '🔴 ON' : '🟢 OFF'}`);
  if (data.whitelist?.length) { console.log(`  Whitelist: ${data.whitelist.length} patterns`); for (const p of data.whitelist) console.log(`    ✅ ${p}`); }
  if (data.blacklist?.length) { console.log(`  Blacklist: ${data.blacklist.length} patterns`); for (const p of data.blacklist) console.log(`    🚫 ${p}`); }
}

async function cmdCheck() {
  const cmd = process.argv.slice(3).join(' ');
  if (!cmd) { console.error('Usage: guardclaw check <command>'); process.exit(1); }

  console.log(`⛨  Analyzing: ${cmd}\n`);
  // persist:true → server records this as a `cli-check` event so it shows up
  // in `guardclaw history` and the dashboard.
  const r = await gcApi('/api/safeguard/analyze', 'POST', { command: cmd, persist: true });
  const score = r.riskScore ?? '?';
  const icon  = score <= 3 ? '🟢' : score <= 6 ? '🟡' : score <= 8 ? '🟠' : '🔴';

  console.log(`  Risk:    ${icon} ${score}/10`);
  console.log(`  Verdict: ${r.verdict || r.category || 'unknown'}`);
  console.log(`  Allowed: ${r.allowed ? 'Yes' : 'No'}`);
  console.log(`  Backend: ${r.backend || 'unknown'}`);
  if (r.reasoning) console.log(`  Reason:  ${r.reasoning}`);
}

async function cmdApprovals() {
  const data = await gcApi('/api/approvals/pending');
  const pending = data.pending || data || [];
  console.log('⛨  Pending Approvals\n');
  if (!pending.length) { console.log('  None.'); return; }
  for (const a of pending) {
    const ts = a.timestamp ? new Date(a.timestamp).toLocaleTimeString() : '';
    console.log(`  ${ts}  [${a.id}]  ${a.toolName || a.tool}: ${(a.summary || '').substring(0, 60)}`);
  }
  console.log(`\n  Total: ${pending.length}`);
}

async function cmdMemory() {
  const [stats, patterns] = await Promise.all([gcApi('/api/memory/stats'), gcApi('/api/memory/patterns?limit=20')]);
  console.log('⛨  Learned Patterns\n');
  console.log(`  Decisions: ${stats.totalDecisions ?? 0}  Patterns: ${stats.totalPatterns ?? 0}\n`);

  const list = patterns.patterns || patterns || [];
  if (!list.length) { console.log('  None yet.'); return; }
  for (const p of list.slice(0, 20)) {
    const conf  = p.confidence != null ? ` (${p.confidence.toFixed(2)})` : '';
    const icon  = p.suggestedAction === 'auto-approve' ? '✅' : p.suggestedAction === 'auto-deny' ? '🚫' : '⚪';
    console.log(`  ${icon}  ${(p.pattern || '').substring(0, 60)}${conf}`);
  }
}

async function cmdBrief() {
  const data = await gcApi('/api/security-memory');
  if (!data?.sessions || Object.keys(data.sessions).length === 0) {
    console.log('⛨  Security Memory — no active sessions');
    return;
  }
  console.log(`⛨  Security Memory — ${data.totalSessions} active session(s)\n`);
  for (const [key, s] of Object.entries(data.sessions)) {
    const isSub = key.includes(':subagent:');
    const label = isSub
      ? key.replace(/.*:subagent:/, '↳ subagent:').slice(0, 40)
      : (key.length > 40 ? key.slice(0, 37) + '...' : key);
    const pct = ((s.bufferTokens / 60000) * 100).toFixed(1);
    console.log(`  ${label}`);
    console.log(`    Raw events: ${s.rawEvents}  Buffer: ${s.bufferTokens.toLocaleString()} / 60,000 tokens (${pct}%)`);
    console.log(`    Compressions: ${s.compressionCount}  Brief: ${s.briefTokens ? s.briefTokens.toLocaleString() + ' tokens' : 'none'}`);
    console.log();
  }
}

// ─── Command router ───────────────────────────────────────────────────────────

switch (command) {
  case 'status':                    cmdStatus(); break;
  case 'stats':                     cmdStats(); break;
  case 'history': case 'log': case 'logs': cmdHistory(); break;
  case 'model':   case 'models':    cmdModel(); break;
  case 'blocking': case 'block':    cmdBlocking(); break;
  case 'check':   case 'analyze':   cmdCheck(); break;
  case 'approvals': case 'pending': cmdApprovals(); break;
  case 'memory':  case 'patterns':  cmdMemory(); break;
  case 'brief':   case 'buffer':    cmdBrief(); break;
  case 'hooks':                     cmdHooks(); break;
  case 'start':                     startServer(); break;
  case 'stop':                      stopServer(); break;
  case 'restart': case 'rs': case 'r': restartServer(); break;
  case 'config':                    handleConfigCommand(); break;
  case 'setup':   case 'wizard':    runOnboarding(); break;
  case 'plugin':                    handlePluginCommand(); break;
  case 'update':  case 'upgrade':   updateGuardClaw(); break;
  case 'version': case '--version': case '-v': showVersion(); break;
  case 'help': case '--help': case '-h': case undefined: showHelp(); break;
  default:
    console.error(`Unknown command: ${command}`);
    console.log('Run "guardclaw help" for usage.');
    process.exit(1);
}
