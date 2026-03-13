#!/usr/bin/env node
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const command = process.argv[2];

const GC_PORT = process.env.GUARDCLAW_PORT || process.env.PORT || 3002;
const GC_BASE = `http://127.0.0.1:${GC_PORT}`;

/** Fetch JSON from GuardClaw API. Returns null on connection failure. */
async function gcApi(path, method = 'GET', body) {
  const url = `${GC_BASE}${path}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED') {
      console.error('❌ GuardClaw is not running (connection refused on port ' + GC_PORT + ')');
      console.error('   Start it with: guardclaw start');
    } else {
      console.error(`❌ API error: ${err.message}`);
    }
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
🛡️  GuardClaw - AI Agent Safety Monitor

Usage:
  guardclaw status                   Server status overview
  guardclaw stats                    Evaluation statistics & token usage
  guardclaw history [n]              Recent evaluations (default: 20)
  guardclaw model                    Current LLM model info
  guardclaw model load <id>          Load a built-in model
  guardclaw model unload             Unload current model
  guardclaw blocking [on|off]        Show or toggle blocking mode
  guardclaw check <command>          Manually check a command's risk score
  guardclaw approvals                Show pending approvals
  guardclaw memory                   Show learned patterns

  guardclaw start [options]          Start the GuardClaw server
  guardclaw stop                     Stop the GuardClaw server
  guardclaw config <command>         Manage configuration
  guardclaw plugin <command>         Manage the OpenClaw interceptor plugin
  guardclaw update                   Update GuardClaw to latest version
  guardclaw help                     Show this help message
  guardclaw version                  Show version

Config Commands:
  guardclaw config set-token <token>    Set OpenClaw Gateway token
  guardclaw config get-token            Show current token (from .env)
  guardclaw config detect-token         Auto-detect token from OpenClaw config
  guardclaw config show                 Show all config values

Plugin Commands:
  guardclaw plugin install              Install the OpenClaw interceptor plugin
  guardclaw plugin uninstall            Uninstall the OpenClaw interceptor plugin
  guardclaw plugin status               Show plugin installation status

Start Options:
  --port <port>              Port to run on (default: 3002)
  --openclaw-url <url>       OpenClaw Gateway URL (default: ws://127.0.0.1:18789)
  --openclaw-token <token>   OpenClaw authentication token
  --anthropic-key <key>      Anthropic API key for safeguard
  --no-open                  Don't open browser automatically

Environment variables:
  OPENCLAW_URL              OpenClaw Gateway WebSocket URL
  OPENCLAW_TOKEN            OpenClaw authentication token
  ANTHROPIC_API_KEY         Anthropic API key
  PORT                      Server port
  GUARDCLAW_PORT            Port for CLI queries (default: same as PORT)

Examples:
  guardclaw status
  guardclaw check "rm -rf /"
  guardclaw history 10
  guardclaw blocking on
  guardclaw start --port 3002

More info: https://github.com/TobyGE/GuardClaw
  `);
}

function showVersion() {
  const packagePath = join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  console.log(`GuardClaw v${pkg.version}`);
}

function stopServer() {
  console.log('🛑 Stopping GuardClaw...\n');
  
  try {
    // Find GuardClaw processes - more specific pattern to avoid matching other node processes
    const result = execSync('ps aux | grep "[n]ode.*guardclaw.*server/index.js"', { 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
    
    if (!result) {
      console.log('ℹ️  GuardClaw is not running.');
      return;
    }
    
    const lines = result.split('\n').filter(line => line.trim());
    let stopped = 0;
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const pid = parts[1]; // PID is second column
        try {
          process.kill(pid, 'SIGKILL'); // Use SIGKILL for immediate termination
          stopped++;
          console.log(`✅ Stopped GuardClaw (PID ${pid})`);
        } catch (err) {
          if (err.code !== 'ESRCH') { // Ignore "process not found" errors
            console.error(`⚠️  Could not stop process ${pid}:`, err.message);
          }
        }
      }
    }
    
    if (stopped > 0) {
      console.log(`\n✅ Successfully stopped ${stopped} GuardClaw process(es)`);
    }
  } catch (error) {
    // If no processes found, execSync throws (exit code 1)
    if (error.status === 1) {
      console.log('ℹ️  GuardClaw is not running.');
    } else {
      console.error('❌ Error checking for GuardClaw processes:', error.message);
      process.exit(1);
    }
  }
}

function getEnvPath() {
  return join(process.cwd(), '.env');
}

function readEnvFile() {
  const envPath = getEnvPath();
  if (!fs.existsSync(envPath)) {
    return '';
  }
  return fs.readFileSync(envPath, 'utf8');
}

function writeEnvFile(content) {
  const envPath = getEnvPath();
  fs.writeFileSync(envPath, content, 'utf8');
}

function configSetToken() {
  const token = process.argv[4];
  
  if (!token) {
    console.error('❌ Error: Token is required');
    console.log('Usage: guardclaw config set-token <token>');
    process.exit(1);
  }
  
  console.log('💾 Setting OpenClaw token...\n');
  
  let envContent = readEnvFile();
  const tokenRegex = /^OPENCLAW_TOKEN=.*/m;
  
  if (tokenRegex.test(envContent)) {
    envContent = envContent.replace(tokenRegex, `OPENCLAW_TOKEN=${token}`);
    console.log('✅ Updated OPENCLAW_TOKEN in .env');
  } else {
    envContent += `\nOPENCLAW_TOKEN=${token}\n`;
    console.log('✅ Added OPENCLAW_TOKEN to .env');
  }
  
  writeEnvFile(envContent);
  console.log(`📝 Token saved to: ${getEnvPath()}`);
  console.log('\n💡 Restart GuardClaw to apply changes:\n   guardclaw stop && guardclaw start\n');
}

function configGetToken() {
  const envContent = readEnvFile();
  const tokenMatch = envContent.match(/^OPENCLAW_TOKEN=(.*)$/m);
  
  if (tokenMatch && tokenMatch[1]) {
    const token = tokenMatch[1].trim();
    const masked = token.substring(0, 16) + '...' + token.substring(token.length - 8);
    console.log('🔑 Current OpenClaw token:');
    console.log(`   ${masked} (from .env)`);
    console.log(`\n📝 Full token: ${token}`);
  } else {
    console.log('ℹ️  No token found in .env file');
    console.log('💡 Set one with: guardclaw config set-token <token>');
    console.log('💡 Or auto-detect: guardclaw config detect-token');
  }
}

function configDetectToken() {
  const autoSave = process.argv[4] === '--save' || process.argv[4] === '-s';
  
  console.log('🔍 Detecting OpenClaw token...\n');
  
  const configPath = join(os.homedir(), '.openclaw', 'openclaw.json');
  
  if (!fs.existsSync(configPath)) {
    console.error('❌ OpenClaw config not found at:', configPath);
    console.log('\n💡 Make sure OpenClaw is installed and configured.');
    process.exit(1);
  }
  
  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configContent);
    const token = config?.gateway?.auth?.token;
    
    if (!token) {
      console.error('❌ Token not found in OpenClaw config');
      console.log('💡 Check your OpenClaw configuration.');
      process.exit(1);
    }
    
    const masked = token.substring(0, 16) + '...' + token.substring(token.length - 8);
    console.log('✅ Found token in OpenClaw config:');
    console.log(`   ${masked}`);
    console.log(`\n📝 Source: ${configPath}`);
    
    // Auto-save if --save flag is provided
    if (autoSave) {
      let envContent = readEnvFile();
      const tokenRegex = /^OPENCLAW_TOKEN=.*/m;
      
      if (tokenRegex.test(envContent)) {
        envContent = envContent.replace(tokenRegex, `OPENCLAW_TOKEN=${token}`);
      } else {
        envContent += `\nOPENCLAW_TOKEN=${token}\n`;
      }
      
      writeEnvFile(envContent);
      console.log('\n✅ Token saved to .env');
      console.log('💡 Restart GuardClaw to apply changes:\n   guardclaw stop && guardclaw start\n');
    } else {
      console.log('\n💡 To save this token, run:');
      console.log(`   guardclaw config set-token ${token}`);
      console.log('\n💡 Or add --save flag:');
      console.log(`   guardclaw config detect-token --save`);
    }
  } catch (error) {
    console.error('❌ Error reading OpenClaw config:', error.message);
    process.exit(1);
  }
}

function configShow() {
  console.log('⚙️  GuardClaw Configuration\n');
  
  const envPath = getEnvPath();
  if (!fs.existsSync(envPath)) {
    console.log('ℹ️  No .env file found at:', envPath);
    console.log('\n💡 Create one with environment variables, or use command-line options.');
    return;
  }
  
  const envContent = readEnvFile();
  const vars = {
    'BACKEND': 'Backend mode (auto/openclaw/nanobot)',
    'OPENCLAW_URL': 'OpenClaw Gateway URL',
    'OPENCLAW_TOKEN': 'OpenClaw authentication token',
    'NANOBOT_URL': 'Nanobot Gateway URL',
    'SAFEGUARD_BACKEND': 'Safeguard backend (lmstudio/ollama/anthropic)',
    'LMSTUDIO_URL': 'LM Studio API URL',
    'LMSTUDIO_MODEL': 'LM Studio model name',
    'ANTHROPIC_API_KEY': 'Anthropic API key',
    'PORT': 'Server port'
  };
  
  console.log(`📝 Config file: ${envPath}\n`);
  
  for (const [key, description] of Object.entries(vars)) {
    const regex = new RegExp(`^${key}=(.*)$`, 'm');
    const match = envContent.match(regex);
    
    if (match && match[1]) {
      let value = match[1].trim();
      // Mask sensitive values
      if (key.includes('TOKEN') || key.includes('KEY')) {
        if (value.length > 16) {
          value = value.substring(0, 8) + '...' + value.substring(value.length - 4);
        }
      }
      console.log(`✅ ${key.padEnd(20)} ${value}`);
      console.log(`   ${description}`);
    } else {
      console.log(`⚪ ${key.padEnd(20)} (not set)`);
      console.log(`   ${description}`);
    }
    console.log('');
  }
  
  console.log('💡 To modify: guardclaw config set-token <token>');
  console.log('💡 Or edit .env file directly');
}

function handleConfigCommand() {
  const subcommand = process.argv[3];
  
  switch (subcommand) {
    case 'set-token':
      configSetToken();
      break;
    case 'get-token':
      configGetToken();
      break;
    case 'detect-token':
      configDetectToken();
      break;
    case 'show':
      configShow();
      break;
    default:
      console.error(`Unknown config command: ${subcommand || '(none)'}`);
      console.log('\nAvailable config commands:');
      console.log('  guardclaw config set-token <token>');
      console.log('  guardclaw config get-token');
      console.log('  guardclaw config detect-token');
      console.log('  guardclaw config show');
      process.exit(1);
  }
}

function handlePluginCommand() {
  const subcommand = process.argv[3];
  const openclawConfigPath = join(os.homedir(), '.openclaw', 'openclaw.json');
  const pluginSrcDir = join(rootDir, 'plugin', 'guardclaw-interceptor');
  const pluginInstallDir = join(os.homedir(), '.openclaw', 'plugins', 'guardclaw-interceptor');
  const pluginId = 'guardclaw-interceptor';

  function readOpenClawConfig() {
    if (!fs.existsSync(openclawConfigPath)) {
      throw new Error(`OpenClaw config not found at ${openclawConfigPath}\nIs OpenClaw installed?`);
    }
    return JSON.parse(fs.readFileSync(openclawConfigPath, 'utf8'));
  }

  function saveOpenClawConfig(cfg) {
    fs.writeFileSync(openclawConfigPath, JSON.stringify(cfg, null, 2));
  }

  function isInstalled(cfg) {
    const paths = cfg?.plugins?.load?.paths || [];
    return paths.includes(pluginInstallDir);
  }

  switch (subcommand) {
    case 'install': {
      console.log('📦 Installing GuardClaw interceptor plugin...\n');

      // 1. Copy plugin files
      if (!fs.existsSync(pluginSrcDir)) {
        console.error(`❌ Plugin source not found: ${pluginSrcDir}`);
        process.exit(1);
      }
      fs.mkdirSync(pluginInstallDir, { recursive: true });
      for (const file of fs.readdirSync(pluginSrcDir)) {
        fs.copyFileSync(join(pluginSrcDir, file), join(pluginInstallDir, file));
      }
      console.log(`✅ Plugin files copied to: ${pluginInstallDir}`);

      // 2. Update openclaw.json
      let cfg;
      try {
        cfg = readOpenClawConfig();
      } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }

      if (!cfg.plugins) cfg.plugins = {};
      if (!cfg.plugins.load) cfg.plugins.load = {};
      if (!cfg.plugins.load.paths) cfg.plugins.load.paths = [];
      if (!cfg.plugins.entries) cfg.plugins.entries = {};

      // Remove any old paths pointing to a guardclaw-interceptor dir (including stale paths from old installs)
      cfg.plugins.load.paths = cfg.plugins.load.paths.filter(
        p => !p.includes('guardclaw-interceptor') || p === pluginInstallDir
      );
      if (!cfg.plugins.load.paths.includes(pluginInstallDir)) {
        cfg.plugins.load.paths.push(pluginInstallDir);
      }
      cfg.plugins.entries[pluginId] = { enabled: true };

      saveOpenClawConfig(cfg);
      console.log(`✅ OpenClaw config updated: ${openclawConfigPath}`);
      console.log(`✅ Plugin enabled: ${pluginId}\n`);
      console.log('⚠️  Restart OpenClaw Gateway to activate:');
      console.log('   openclaw gateway restart\n');
      console.log('💡 To disable blocking from GuardClaw Dashboard:');
      console.log('   Click the 🛡️ shield icon → Disable Blocking');
      break;
    }

    case 'uninstall': {
      console.log('🗑️  Uninstalling GuardClaw interceptor plugin...\n');

      let cfg;
      try {
        cfg = readOpenClawConfig();
      } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }

      // Remove from paths
      if (cfg?.plugins?.load?.paths) {
        cfg.plugins.load.paths = cfg.plugins.load.paths.filter(p => p !== pluginInstallDir);
      }
      // Fully remove entry so openclaw doesn't try to resolve a missing plugin
      if (cfg?.plugins?.entries) {
        delete cfg.plugins.entries[pluginId];
      }
      saveOpenClawConfig(cfg);
      console.log(`✅ Plugin removed from OpenClaw config`);

      // Remove plugin files
      if (fs.existsSync(pluginInstallDir)) {
        fs.rmSync(pluginInstallDir, { recursive: true });
        console.log(`✅ Plugin files removed: ${pluginInstallDir}`);
      }

      console.log('\n⚠️  Restart OpenClaw Gateway to apply:');
      console.log('   openclaw gateway restart\n');
      break;
    }

    case 'status': {
      let cfg;
      try {
        cfg = readOpenClawConfig();
      } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }

      const installed = isInstalled(cfg);
      const enabled = cfg?.plugins?.entries?.[pluginId]?.enabled;
      const filesExist = fs.existsSync(pluginInstallDir);

      console.log('🔌 GuardClaw Interceptor Plugin Status\n');
      console.log(`  Files installed : ${filesExist ? '✅ Yes' : '❌ No'}  (${pluginInstallDir})`);
      console.log(`  In OpenClaw config: ${installed ? '✅ Yes' : '❌ No'}`);
      console.log(`  Enabled         : ${enabled ? '✅ Yes' : '❌ No (disabled or not installed)'}`);
      console.log();
      if (!installed || !filesExist) {
        console.log('  → Run: guardclaw plugin install');
      } else if (!enabled) {
        console.log('  → Enable via GuardClaw Dashboard (🛡️ Blocking toggle)');
        console.log('  → Or run: guardclaw plugin install  (re-enables)');
      } else {
        console.log('  → Plugin is active. Restart gateway if recently changed.');
      }
      break;
    }

    default:
      console.log('Plugin commands: install | uninstall | status');
      console.log('Run "guardclaw help" for usage information.');
      process.exit(1);
  }
}

function updateGuardClaw() {
  console.log('🔄 Updating GuardClaw to latest version...\n');
  
  // Detect package manager
  let packageManager = 'npm';
  try {
    spawn('pnpm', ['--version'], { stdio: 'ignore' });
    packageManager = 'pnpm';
  } catch (e) {
    // npm is default
  }

  console.log(`📦 Using ${packageManager}...\n`);

  const updateCmd = packageManager === 'npm' 
    ? ['install', '-g', 'guardclaw@latest']
    : ['add', '-g', 'guardclaw@latest'];

  const child = spawn(packageManager, updateCmd, {
    stdio: 'inherit',
    shell: true
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log('\n✅ GuardClaw updated successfully!');
      console.log('💡 Restart your server to use the new version:\n');
      console.log('   guardclaw start\n');
    } else {
      console.error(`\n❌ Update failed with code ${code}`);
      console.error(`💡 Try manually: ${packageManager} ${updateCmd.join(' ')}\n`);
      process.exit(code);
    }
  });

  child.on('error', (err) => {
    console.error('❌ Failed to update:', err.message);
    console.error(`💡 Try manually: ${packageManager} ${updateCmd.join(' ')}\n`);
    process.exit(1);
  });
}

function openBrowser(url) {
  const platform = os.platform();
  let command;
  
  switch (platform) {
    case 'darwin':  // macOS
      command = `open "${url}"`;
      break;
    case 'win32':   // Windows
      command = `start "" "${url}"`;
      break;
    default:        // Linux and others
      command = `xdg-open "${url}"`;
      break;
  }
  
  spawn(command, { shell: true, stdio: 'ignore' });
}

function startServer() {
  const args = process.argv.slice(3);
  const env = { ...process.env };
  let noOpen = false;

  // Parse command-line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
        env.PORT = args[++i];
        break;
      case '--openclaw-url':
      case '--clawdbot-url':
        env.OPENCLAW_URL = args[++i];
        break;
      case '--openclaw-token':
      case '--clawdbot-token':
        env.OPENCLAW_TOKEN = args[++i];
        break;
      case '--anthropic-key':
        env.ANTHROPIC_API_KEY = args[++i];
        break;
      case '--no-open':
        noOpen = true;
        break;
    }
  }

  // Check for required environment variables
  const openclawToken = env.OPENCLAW_TOKEN || env.CLAWDBOT_TOKEN;
  const openclawUrl = env.OPENCLAW_URL || env.CLAWDBOT_URL;
  if (!openclawToken && !openclawUrl?.includes('127.0.0.1')) {
    console.warn('⚠️  No OPENCLAW_TOKEN set. This may be required for remote connections.');
  }

  const port = env.PORT || 3002;
  const url = `http://localhost:${port}`;

  console.log('🛡️  Starting GuardClaw...');
  console.log(`📡 Connecting to: ${openclawUrl || 'ws://127.0.0.1:18789'}`);
  console.log(`🌐 Web UI will be available at: ${url}`);
  console.log('');

  const serverPath = join(rootDir, 'server', 'index.js');
  const child = spawn('node', [serverPath], {
    stdio: 'inherit',
    env,
    cwd: rootDir
  });

  // Open browser after server starts (2 second delay)
  if (!noOpen) {
    setTimeout(() => {
      console.log(`🌐 Opening browser at ${url}...\n`);
      openBrowser(url);
    }, 2000);
  }

  child.on('error', (err) => {
    console.error('❌ Failed to start GuardClaw:', err.message);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`❌ GuardClaw exited with code ${code}`);
      process.exit(code);
    }
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down GuardClaw...');
    child.kill('SIGINT');
  });
}

// ─── Query Commands (talk to running server) ──────────────────────────────────

async function cmdStatus() {
  const [health, status] = await Promise.all([
    gcApi('/api/health'),
    gcApi('/api/status'),
  ]);

  console.log('⛨  GuardClaw Status\n');
  console.log(`  Running:      ${health.ok ? '✅ Yes' : '❌ No'}`);
  console.log(`  PID:          ${health.pid}`);
  console.log(`  Blocking:     ${health.blockingEnabled ? '🔴 ON (blocking)' : '🟢 OFF (monitoring only)'}`);
  console.log(`  Fail-closed:  ${health.failClosed ? 'Yes' : 'No'}`);
  console.log(`  Backend:      ${status.safeguard?.backend || 'unknown'}`);
  console.log(`  Uptime:       ${Math.round((Date.now() - health.ts) / -1000)}s ago (health check)`);

  if (status.poller) {
    console.log(`\n  Sessions:     ${status.poller.activeSessions ?? 'N/A'}`);
  }
  if (status.cache) {
    const c = status.cache;
    console.log(`\n  Cache:        ${c.hits ?? 0} hits / ${c.misses ?? 0} misses / ${c.aiCalls ?? 0} AI calls`);
  }
}

async function cmdStats() {
  const [memStats, status] = await Promise.all([
    gcApi('/api/memory/stats'),
    gcApi('/api/status'),
  ]);

  console.log('⛨  GuardClaw Statistics\n');

  if (memStats) {
    console.log(`  Decisions recorded:  ${memStats.totalDecisions ?? 0}`);
    console.log(`  Patterns learned:    ${memStats.totalPatterns ?? 0}`);
    if (memStats.byDecision) {
      const d = memStats.byDecision;
      console.log(`  ├─ Approved:         ${d.approve ?? 0}`);
      console.log(`  ├─ Denied:           ${d.deny ?? 0}`);
      console.log(`  └─ Auto:             ${d.auto ?? 0}`);
    }
  }

  if (status.cache) {
    const c = status.cache;
    console.log(`\n  Cache hits:          ${c.hits ?? 0}`);
    console.log(`  Cache misses:        ${c.misses ?? 0}`);
    console.log(`  AI calls:            ${c.aiCalls ?? 0}`);
    console.log(`  Rule fast-path:      ${c.ruleCalls ?? 0}`);
  }
}

async function cmdHistory() {
  const limit = parseInt(process.argv[3]) || 20;
  const data = await gcApi(`/api/events/history?limit=${limit}&filter=tool`);
  const events = data.events || data || [];

  console.log(`⛨  Recent Evaluations (last ${limit})\n`);

  if (events.length === 0) {
    console.log('  No evaluations recorded yet.');
    return;
  }

  for (const ev of events) {
    const ts = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : '';
    const tool = ev.toolName || ev.tool || '?';
    const score = ev.riskScore ?? ev.score ?? '?';
    const verdict = ev.verdict || ev.category || '';
    const cmd = (ev.command || ev.summary || '').substring(0, 60);
    const icon = score <= 3 ? '🟢' : score <= 6 ? '🟡' : score <= 8 ? '🟠' : '🔴';

    console.log(`  ${ts}  ${icon} ${String(score).padStart(2)}/10  ${verdict.padEnd(7)}  ${tool}: ${cmd}`);
  }
}

async function cmdModel() {
  const sub = process.argv[3];

  if (sub === 'load') {
    const modelId = process.argv[4];
    if (!modelId) {
      console.error('Usage: guardclaw model load <model-id>');
      console.error('       guardclaw model     (to see available models)');
      process.exit(1);
    }
    console.log(`Loading model ${modelId}...`);
    const result = await gcApi(`/api/models/${modelId}/load`, 'POST');
    console.log(`✅ ${result.status || 'done'}: ${result.modelId || modelId}`);
    return;
  }

  if (sub === 'unload') {
    await gcApi('/api/models/unload', 'POST');
    console.log('✅ Model unloaded');
    return;
  }

  const [models, engineStatus] = await Promise.all([
    gcApi('/api/models'),
    gcApi('/api/models/status'),
  ]);

  console.log('⛨  LLM Models\n');

  if (engineStatus) {
    console.log(`  Engine status:  ${engineStatus.status || 'unknown'}`);
    if (engineStatus.loadedModel) {
      console.log(`  Loaded model:   ${engineStatus.loadedModel}`);
    }
    console.log('');
  }

  if (models?.models) {
    for (const m of models.models) {
      const status = m.loaded ? '🟢 loaded' : m.downloaded ? '⚪ ready' : '⬇️  not downloaded';
      console.log(`  ${m.id.padEnd(20)} ${status}  ${m.size || ''}`);
      if (m.description) console.log(`    ${m.description}`);
    }
  }
}

async function cmdBlocking() {
  const action = process.argv[3];

  if (action === 'on' || action === 'off') {
    const enabled = action === 'on';
    await gcApi('/api/blocking/toggle', 'POST', { enabled });
    console.log(`⛨  Blocking ${enabled ? '🔴 ENABLED' : '🟢 DISABLED'}`);
    return;
  }

  const data = await gcApi('/api/blocking/status');
  console.log('⛨  Blocking Configuration\n');
  console.log(`  Enabled:    ${data.enabled ? '🔴 ON' : '🟢 OFF (monitoring only)'}`);
  if (data.whitelist?.length) {
    console.log(`  Whitelist:  ${data.whitelist.length} patterns`);
    for (const p of data.whitelist) console.log(`    ✅ ${p}`);
  }
  if (data.blacklist?.length) {
    console.log(`  Blacklist:  ${data.blacklist.length} patterns`);
    for (const p of data.blacklist) console.log(`    🚫 ${p}`);
  }
}

async function cmdCheck() {
  const cmd = process.argv.slice(3).join(' ');
  if (!cmd) {
    console.error('Usage: guardclaw check <command>');
    console.error('Example: guardclaw check "rm -rf /"');
    process.exit(1);
  }

  console.log(`⛨  Analyzing: ${cmd}\n`);
  const result = await gcApi('/api/safeguard/analyze', 'POST', { command: cmd });

  const score = result.riskScore ?? '?';
  const icon = score <= 3 ? '🟢' : score <= 6 ? '🟡' : score <= 8 ? '🟠' : '🔴';

  console.log(`  Risk:     ${icon} ${score}/10`);
  console.log(`  Verdict:  ${result.verdict || result.category || 'unknown'}`);
  console.log(`  Allowed:  ${result.allowed ? 'Yes' : 'No'}`);
  console.log(`  Backend:  ${result.backend || 'unknown'}`);
  if (result.reasoning) {
    console.log(`  Reason:   ${result.reasoning}`);
  }
}

async function cmdApprovals() {
  const data = await gcApi('/api/approvals/pending');
  const pending = data.pending || data || [];

  console.log('⛨  Pending Approvals\n');

  if (pending.length === 0) {
    console.log('  No pending approvals.');
    return;
  }

  for (const a of pending) {
    const ts = a.timestamp ? new Date(a.timestamp).toLocaleTimeString() : '';
    console.log(`  ${ts}  [${a.id}]  ${a.toolName || a.tool}: ${(a.summary || '').substring(0, 60)}`);
  }
  console.log(`\n  Total: ${pending.length} pending`);
}

async function cmdMemory() {
  const [stats, patterns] = await Promise.all([
    gcApi('/api/memory/stats'),
    gcApi('/api/memory/patterns?limit=20'),
  ]);

  console.log('⛨  Memory & Learned Patterns\n');
  console.log(`  Decisions:  ${stats.totalDecisions ?? 0}`);
  console.log(`  Patterns:   ${stats.totalPatterns ?? 0}\n`);

  const list = patterns.patterns || patterns || [];
  if (list.length === 0) {
    console.log('  No patterns learned yet.');
    return;
  }

  for (const p of list.slice(0, 20)) {
    const conf = p.confidence != null ? ` (conf: ${p.confidence.toFixed(2)})` : '';
    const icon = p.suggestedAction === 'auto-approve' ? '✅' : p.suggestedAction === 'auto-deny' ? '🚫' : '⚪';
    const label = (p.pattern || '').substring(0, 60);
    console.log(`  ${icon}  ${label}${conf}`);
  }
}

// ─── Command Router ────────────────────────────────────────────────────────────

switch (command) {
  case 'status':
    cmdStatus();
    break;
  case 'stats':
    cmdStats();
    break;
  case 'history':
  case 'log':
  case 'logs':
    cmdHistory();
    break;
  case 'model':
  case 'models':
    cmdModel();
    break;
  case 'blocking':
  case 'block':
    cmdBlocking();
    break;
  case 'check':
  case 'analyze':
    cmdCheck();
    break;
  case 'approvals':
  case 'pending':
    cmdApprovals();
    break;
  case 'memory':
  case 'patterns':
    cmdMemory();
    break;
  case 'start':
    startServer();
    break;
  case 'stop':
    stopServer();
    break;
  case 'config':
    handleConfigCommand();
    break;
  case 'plugin':
    handlePluginCommand();
    break;
  case 'update':
  case 'upgrade':
    updateGuardClaw();
    break;
  case 'version':
  case '--version':
  case '-v':
    showVersion();
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    showHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.log('Run "guardclaw help" for usage information.');
    process.exit(1);
}
