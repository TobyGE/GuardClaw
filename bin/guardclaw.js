#!/usr/bin/env node
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createInterface } from 'readline';
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const command = process.argv[2];
const GC_PORT = parseInt(process.env.GUARDCLAW_PORT || process.env.PORT || 3002);
const GC_BASE = `http://127.0.0.1:${GC_PORT}`;

// ─── API helper ───────────────────────────────────────────────────────────────

async function gcApi(path, method = 'GET', body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${GC_BASE}${path}`, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED') {
      console.error(`❌ GuardClaw is not running (port ${GC_PORT})`);
      console.error('   Start it with: guardclaw start');
    } else {
      console.error(`❌ API error: ${err.message}`);
    }
    process.exit(1);
  }
}

// ─── Readline helpers ─────────────────────────────────────────────────────────

function createPrompt() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, a => resolve(a.trim())));
}

// ─── .env helpers ─────────────────────────────────────────────────────────────

function getEnvPath() {
  return join(process.cwd(), '.env');
}

function readEnvFile() {
  try { return fs.readFileSync(getEnvPath(), 'utf8'); } catch { return ''; }
}

function writeEnvFile(content) {
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

// ─── Install / onboarding state ───────────────────────────────────────────────

function getInstallJsonPath() {
  return join(process.cwd(), '.guardclaw', 'install.json');
}

function isOnboardingDone() {
  // 1. 明确标记过
  try {
    if (JSON.parse(fs.readFileSync(getInstallJsonPath(), 'utf8')).onboardingCompleted) return true;
  } catch {}
  // 2. .env 已有核心配置 → 老用户，跳过 onboarding
  const env = readEnvFile();
  if (getEnvVar(env, 'SAFEGUARD_BACKEND')) return true;
  return false;
}

function markOnboardingDone() {
  const p = getInstallJsonPath();
  fs.mkdirSync(join(process.cwd(), '.guardclaw'), { recursive: true });
  let d = {};
  try { d = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  d.onboardingCompleted = true;
  d.onboardingAt = d.onboardingAt || new Date().toISOString();
  if (!d.installedAt) d.installedAt = d.onboardingAt;
  fs.writeFileSync(p, JSON.stringify(d, null, 2));
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
const CODEX_HOOK_SCRIPT = join(rootDir, 'scripts', 'codex-hook.sh');

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

function detectAgents() {
  const env = readEnvFile();
  const agents = [];

  // Claude Code
  if (fs.existsSync(join(os.homedir(), '.claude'))) {
    agents.push({ id: 'claude-code', label: 'Claude Code', type: 'hook', installed: isClaudeCodeHooksInstalled() });
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

  // Codex
  if (fs.existsSync(join(os.homedir(), '.codex'))) {
    agents.push({ id: 'codex', label: 'Codex', type: 'hook', installed: isCodexHooksInstalled() });
  }

  return agents;
}

// ─── Onboarding wizard ────────────────────────────────────────────────────────

async function runOnboarding() {
  console.log('\n🛡️  Welcome to GuardClaw!\n');
  console.log('Let\'s get you set up. Press Enter to accept defaults in [brackets].\n');

  const rl = createPrompt();
  let env = readEnvFile();

  // ── Step 1: LLM backend ──────────────────────────────────────────────────────
  console.log('── Step 1 of 3: LLM backend ────────────────────────────────────────\n');
  console.log('  1) lmstudio   Local LLM via LM Studio  (recommended, private)');
  console.log('  2) ollama     Local LLM via Ollama');
  console.log('  3) anthropic  Claude API               (best accuracy, needs key)');
  console.log('  4) built-in   Download model locally   (Apple Silicon only)');
  console.log('  5) fallback   Rule-based only, no LLM\n');

  const backendChoice = await ask(rl, 'Choice [1]: ');
  const backendMap = { '': 'lmstudio', '1': 'lmstudio', '2': 'ollama', '3': 'anthropic', '4': 'built-in', '5': 'fallback' };
  const backend = backendMap[backendChoice] ?? 'lmstudio';
  env = setEnvVar(env, 'SAFEGUARD_BACKEND', backend);
  console.log(`  → ${backend}\n`);

  if (backend === 'anthropic') {
    const key = await ask(rl, 'Anthropic API key: ');
    if (key) env = setEnvVar(env, 'ANTHROPIC_API_KEY', key);
    else console.log('  (skipped — set later: guardclaw config set ANTHROPIC_API_KEY <key>)');
  } else if (backend === 'lmstudio') {
    const url = await ask(rl, 'LM Studio URL [http://localhost:1234/v1]: ');
    env = setEnvVar(env, 'LMSTUDIO_URL', url || 'http://localhost:1234/v1');
    const model = await ask(rl, 'Model name [auto]: ');
    env = setEnvVar(env, 'LMSTUDIO_MODEL', model || 'auto');
  } else if (backend === 'ollama') {
    const url = await ask(rl, 'Ollama URL [http://localhost:11434]: ');
    env = setEnvVar(env, 'OLLAMA_URL', url || 'http://localhost:11434');
    const model = await ask(rl, 'Model name [llama3]: ');
    env = setEnvVar(env, 'OLLAMA_MODEL', model || 'llama3');
  }

  // ── Step 2: Approval mode ────────────────────────────────────────────────────
  console.log('\n── Step 2 of 3: Approval mode ──────────────────────────────────────\n');
  console.log('  1) auto         Auto-allow safe, auto-block dangerous  (recommended)');
  console.log('  2) prompt       Ask you for medium-risk commands');
  console.log('  3) monitor-only Never block, just log and analyze\n');

  const modeChoice = await ask(rl, 'Choice [1]: ');
  const modeMap = { '': 'auto', '1': 'auto', '2': 'prompt', '3': 'monitor-only' };
  const mode = modeMap[modeChoice] ?? 'auto';
  env = setEnvVar(env, 'GUARDCLAW_APPROVAL_MODE', mode);
  console.log(`  → ${mode}`);

  // ── Step 3: Agent connections ────────────────────────────────────────────────
  const agents = detectAgents();

  if (agents.length > 0) {
    console.log('\n── Step 3 of 3: Agent connections ──────────────────────────────────\n');
    console.log('  Detected on your system:\n');

    for (const agent of agents) {
      if (agent.installed) {
        console.log(`  ✅ ${agent.label.padEnd(14)} already connected, skip`);
        continue;
      }

      if (agent.type === 'hook') {
        const ans = await ask(rl, `  Connect ${agent.label}? [Y/n] `);
        if (ans !== 'n' && ans !== 'N') {
          if (agent.id === 'claude-code') installClaudeCodeHooks(GC_PORT);
          if (agent.id === 'codex') installCodexHooks();
          console.log(`  ✅ ${agent.label} hooks installed`);
        }
      } else if (agent.type === 'ws' && agent.token) {
        const masked = agent.token.slice(0, 8) + '...';
        const ans = await ask(rl, `  Save ${agent.label} token (${masked})? [Y/n] `);
        if (ans !== 'n' && ans !== 'N') {
          if (agent.id === 'openclaw') env = setEnvVar(env, 'OPENCLAW_TOKEN', agent.token);
          if (agent.id === 'qclaw')    env = setEnvVar(env, 'QCLAW_TOKEN', agent.token);
          console.log(`  ✅ ${agent.label} token saved`);
        }
      }
    }
  }

  rl.close();

  writeEnvFile(env);
  markOnboardingDone();

  console.log('\n✅ Setup complete. Config saved to:', getEnvPath());
  console.log('   To change settings later: guardclaw config\n');
}

// ─── Interactive config menu ──────────────────────────────────────────────────

async function configLLM() {
  const rl = createPrompt();
  let env = readEnvFile();
  const current = getEnvVar(env, 'SAFEGUARD_BACKEND') || 'lmstudio';

  console.log('\n── LLM Backend ─────────────────────────────────────────────────────\n');
  console.log(`  Current: ${current}\n`);
  console.log('  1) lmstudio  2) ollama  3) anthropic  4) built-in  5) fallback\n');

  const choice = await ask(rl, `Choice [${current}]: `);
  const backendMap = { '1': 'lmstudio', '2': 'ollama', '3': 'anthropic', '4': 'built-in', '5': 'fallback' };
  const backend = backendMap[choice] ?? (choice || current);
  env = setEnvVar(env, 'SAFEGUARD_BACKEND', backend);

  if (backend === 'anthropic') {
    const existing = getEnvVar(env, 'ANTHROPIC_API_KEY');
    const key = await ask(rl, `API key [${existing ? existing.slice(0,8)+'...' : 'not set'}]: `);
    if (key) env = setEnvVar(env, 'ANTHROPIC_API_KEY', key);
  } else if (backend === 'lmstudio') {
    const u = await ask(rl, `URL [${getEnvVar(env, 'LMSTUDIO_URL') || 'http://localhost:1234/v1'}]: `);
    if (u) env = setEnvVar(env, 'LMSTUDIO_URL', u);
    const m = await ask(rl, `Model [${getEnvVar(env, 'LMSTUDIO_MODEL') || 'auto'}]: `);
    if (m) env = setEnvVar(env, 'LMSTUDIO_MODEL', m);
  } else if (backend === 'ollama') {
    const u = await ask(rl, `URL [${getEnvVar(env, 'OLLAMA_URL') || 'http://localhost:11434'}]: `);
    if (u) env = setEnvVar(env, 'OLLAMA_URL', u);
    const m = await ask(rl, `Model [${getEnvVar(env, 'OLLAMA_MODEL') || 'llama3'}]: `);
    if (m) env = setEnvVar(env, 'OLLAMA_MODEL', m);
  }

  rl.close();
  writeEnvFile(env);
  console.log(`\n✅ Backend set to: ${backend}  (restart to apply)\n`);
}

async function configMode() {
  const rl = createPrompt();
  let env = readEnvFile();
  const current = getEnvVar(env, 'GUARDCLAW_APPROVAL_MODE') || 'auto';

  console.log('\n── Approval Mode ───────────────────────────────────────────────────\n');
  console.log(`  Current: ${current}\n`);
  console.log('  1) auto  2) prompt  3) monitor-only\n');

  const choice = await ask(rl, `Choice [${current}]: `);
  const modeMap = { '1': 'auto', '2': 'prompt', '3': 'monitor-only' };
  const mode = modeMap[choice] ?? (choice || current);

  rl.close();
  writeEnvFile(setEnvVar(env, 'GUARDCLAW_APPROVAL_MODE', mode));
  console.log(`\n✅ Mode set to: ${mode}  (restart to apply)\n`);
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
  console.log('\n✅ Thresholds updated  (restart to apply)\n');
}

async function configAgentsInteractive() {
  const agents = detectAgents();

  if (agents.length === 0) {
    console.log('\n  No supported agents detected on this system.\n');
    return;
  }

  const rl = createPrompt();
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
        const ans = await ask(rl, `  Remove ${agent.label} hooks? [y/N] `);
        if (ans === 'y' || ans === 'Y') {
          if (agent.id === 'claude-code') uninstallClaudeCodeHooks();
          if (agent.id === 'codex') uninstallCodexHooks();
          console.log(`  ✅ ${agent.label} hooks removed`);
        }
      } else {
        const ans = await ask(rl, `  Install ${agent.label} hooks? [Y/n] `);
        if (ans !== 'n' && ans !== 'N') {
          if (agent.id === 'claude-code') installClaudeCodeHooks(GC_PORT);
          if (agent.id === 'codex') installCodexHooks();
          console.log(`  ✅ ${agent.label} hooks installed`);
        }
      }
    } else if (agent.type === 'ws' && agent.token) {
      if (!agent.installed) {
        const masked = agent.token.slice(0, 8) + '...';
        const ans = await ask(rl, `  Save ${agent.label} token (${masked})? [Y/n] `);
        if (ans !== 'n' && ans !== 'N') {
          if (agent.id === 'openclaw') env = setEnvVar(env, 'OPENCLAW_TOKEN', agent.token);
          if (agent.id === 'qclaw')    env = setEnvVar(env, 'QCLAW_TOKEN', agent.token);
          console.log(`  ✅ ${agent.label} token saved`);
        }
      }
    }
  }

  rl.close();
  writeEnvFile(env);
  console.log('');
}

async function runInteractiveConfig() {
  const rl = createPrompt();
  console.log('\n⚙️  GuardClaw Configuration\n');
  console.log('  1) LLM backend');
  console.log('  2) Approval mode');
  console.log('  3) Risk thresholds');
  console.log('  4) Agent connections');
  console.log('  5) Show all settings');
  console.log('  6) Re-run setup wizard');
  console.log('  q) Quit\n');

  const choice = await ask(rl, 'Choose: ');
  rl.close();

  switch (choice) {
    case '1': await configLLM(); break;
    case '2': await configMode(); break;
    case '3': await configThresholds(); break;
    case '4': await configAgentsInteractive(); break;
    case '5': configShow(); break;
    case '6': await runOnboarding(); break;
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
  guardclaw config [command]         Configuration (interactive menu if no command)
  guardclaw hooks [command]          Manage Claude Code / Codex hook integrations
  guardclaw plugin [command]         Manage OpenClaw interceptor plugin
  guardclaw update                   Update GuardClaw
  guardclaw version / help

Config Commands:
  guardclaw config                   Interactive menu
  guardclaw config show              Show all settings
  guardclaw config set <KEY> <VAL>   Set any variable
  guardclaw config llm               Change LLM backend
  guardclaw config mode              Change approval mode
  guardclaw config thresholds        Change risk thresholds
  guardclaw config agents            Manage agent connections
  guardclaw config setup             Re-run setup wizard
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
  try {
    const result = execSync('ps aux | grep "[n]ode.*guardclaw.*server/index.js"',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (!result) { console.log('ℹ️  GuardClaw is not running.'); return; }

    let stopped = 0;
    for (const line of result.split('\n').filter(Boolean)) {
      const pid = line.trim().split(/\s+/)[1];
      try { process.kill(pid, 'SIGKILL'); stopped++; console.log(`✅ Stopped PID ${pid}`); }
      catch (e) { if (e.code !== 'ESRCH') console.error(`⚠️  Could not stop ${pid}:`, e.message); }
    }
    if (stopped) console.log(`\n✅ Stopped ${stopped} process(es)`);
  } catch (e) {
    if (e.status === 1) console.log('ℹ️  GuardClaw is not running.');
    else { console.error('❌ Error:', e.message); process.exit(1); }
  }
}

// ─── Config commands ──────────────────────────────────────────────────────────

function configSetDirect() {
  const key = process.argv[4], value = process.argv[5];
  if (!key || !value) {
    console.error('Usage: guardclaw config set <KEY> <VALUE>');
    process.exit(1);
  }
  writeEnvFile(setEnvVar(readEnvFile(), key, value));
  const display = (key.includes('KEY') || key.includes('TOKEN')) && value.length > 8
    ? value.slice(0, 8) + '...' : value;
  console.log(`✅ ${key} = ${display}  (restart to apply)\n`);
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
      ['SAFEGUARD_BACKEND',  'Backend (lmstudio/ollama/anthropic/built-in/fallback)'],
      ['LMSTUDIO_URL',       'LM Studio URL'],
      ['LMSTUDIO_MODEL',     'LM Studio model'],
      ['OLLAMA_URL',         'Ollama URL'],
      ['OLLAMA_MODEL',       'Ollama model'],
      ['ANTHROPIC_API_KEY',  'Anthropic API key'],
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
    case 'llm':        await configLLM(); break;
    case 'mode':       await configMode(); break;
    case 'thresholds': await configThresholds(); break;
    case 'agents':     await configAgentsInteractive(); break;
    case 'set':        configSetDirect(); break;
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
  console.log('🔄 Updating GuardClaw...\n');
  const child = spawn('npm', ['install', '-g', 'guardclaw@latest'], { stdio: 'inherit', shell: true });
  child.on('exit', code => {
    if (code === 0) console.log('\n✅ Updated. Restart: guardclaw start\n');
    else { console.error(`\n❌ Update failed (code ${code})`); process.exit(code); }
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
  let noOpen = false, noOnboarding = false;

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
    }
  }

  if (!noOnboarding && !isOnboardingDone() && process.stdin.isTTY) {
    await runOnboarding();
  }

  const port = env.PORT || 3002;
  const url  = `http://localhost:${port}`;

  console.log('🛡️  Starting GuardClaw...');
  console.log(`🌐 Dashboard: ${url}\n`);

  const child = spawn('node', [join(rootDir, 'server', 'index.js')], {
    stdio: 'inherit', env, cwd: rootDir,
  });

  if (!noOpen) setTimeout(() => { openBrowser(url); }, 2000);

  child.on('error', e => { console.error('❌ Failed to start:', e.message); process.exit(1); });
  child.on('exit', code => { if (code !== 0) { console.error(`❌ Exited with code ${code}`); process.exit(code); } });
  process.on('SIGINT', () => { console.log('\n👋 Shutting down...'); child.kill('SIGINT'); });
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
    console.log(`\n  Events: ${ec.total} total  🟢 ${ec.safe} safe  🟡 ${ec.warn} warn  🔴 ${ec.blocked} blocked`);
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
  const limit = parseInt(process.argv[3]) || 20;
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
  const r = await gcApi('/api/safeguard/analyze', 'POST', { command: cmd });
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
  case 'hooks':                     cmdHooks(); break;
  case 'start':                     startServer(); break;
  case 'stop':                      stopServer(); break;
  case 'config':                    handleConfigCommand(); break;
  case 'plugin':                    handlePluginCommand(); break;
  case 'update':  case 'upgrade':   updateGuardClaw(); break;
  case 'version': case '--version': case '-v': showVersion(); break;
  case 'help': case '--help': case '-h': case undefined: showHelp(); break;
  default:
    console.error(`Unknown command: ${command}`);
    console.log('Run "guardclaw help" for usage.');
    process.exit(1);
}
