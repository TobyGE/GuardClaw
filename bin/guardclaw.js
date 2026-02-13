#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const command = process.argv[2];

function showHelp() {
  console.log(`
🛡️  GuardClaw - AI Agent Safety Monitor

Usage:
  guardclaw start [options]    Start the GuardClaw server
  guardclaw update            Update GuardClaw to latest version
  guardclaw help              Show this help message
  guardclaw version           Show version

Options:
  --port <port>              Port to run on (default: 3001)
  --openclaw-url <url>       OpenClaw Gateway URL (default: ws://127.0.0.1:18789)
  --openclaw-token <token>   OpenClaw authentication token
  --anthropic-key <key>      Anthropic API key for safeguard

Environment variables:
  OPENCLAW_URL              OpenClaw Gateway WebSocket URL
  OPENCLAW_TOKEN            OpenClaw authentication token
  ANTHROPIC_API_KEY         Anthropic API key
  PORT                      Server port

Examples:
  guardclaw start
  guardclaw update
  guardclaw start --port 3002
  guardclaw start --openclaw-url ws://192.168.1.100:18789

Configuration:
  Create a .env file in your current directory or use environment variables.
  See .env.example for reference.

More info: https://github.com/TobyGE/GuardClaw
  `);
}

function showVersion() {
  const packagePath = join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  console.log(`GuardClaw v${pkg.version}`);
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

function startServer() {
  const args = process.argv.slice(3);
  const env = { ...process.env };

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
    }
  }

  // Check for required environment variables
  const openclawToken = env.OPENCLAW_TOKEN || env.CLAWDBOT_TOKEN;
  const openclawUrl = env.OPENCLAW_URL || env.CLAWDBOT_URL;
  if (!openclawToken && !openclawUrl?.includes('127.0.0.1')) {
    console.warn('⚠️  No OPENCLAW_TOKEN set. This may be required for remote connections.');
  }

  console.log('🛡️  Starting GuardClaw...');
  console.log(`📡 Connecting to: ${openclawUrl || 'ws://127.0.0.1:18789'}`);
  console.log(`🌐 Web UI will be available at: http://localhost:${env.PORT || 3001}`);
  console.log('');

  const serverPath = join(rootDir, 'server', 'index.js');
  const child = spawn('node', [serverPath], {
    stdio: 'inherit',
    env,
    cwd: rootDir
  });

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

switch (command) {
  case 'start':
    startServer();
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
