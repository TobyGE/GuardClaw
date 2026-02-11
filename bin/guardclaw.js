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
  guardclaw help              Show this help message
  guardclaw version           Show version

Options:
  --port <port>              Port to run on (default: 3001)
  --clawdbot-url <url>       Clawdbot Gateway URL (default: ws://127.0.0.1:18789)
  --clawdbot-token <token>   Clawdbot authentication token
  --anthropic-key <key>      Anthropic API key for safeguard

Environment variables:
  CLAWDBOT_URL              Clawdbot Gateway WebSocket URL
  CLAWDBOT_TOKEN            Clawdbot authentication token
  ANTHROPIC_API_KEY         Anthropic API key
  PORT                      Server port

Examples:
  guardclaw start
  guardclaw start --port 3002
  guardclaw start --clawdbot-url ws://192.168.1.100:18789

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

function startServer() {
  const args = process.argv.slice(3);
  const env = { ...process.env };

  // Parse command-line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
        env.PORT = args[++i];
        break;
      case '--clawdbot-url':
        env.CLAWDBOT_URL = args[++i];
        break;
      case '--clawdbot-token':
        env.CLAWDBOT_TOKEN = args[++i];
        break;
      case '--anthropic-key':
        env.ANTHROPIC_API_KEY = args[++i];
        break;
    }
  }

  // Check for required environment variables
  if (!env.CLAWDBOT_TOKEN && !env.CLAWDBOT_URL?.includes('127.0.0.1')) {
    console.warn('⚠️  No CLAWDBOT_TOKEN set. This may be required for remote connections.');
  }

  console.log('🛡️  Starting GuardClaw...');
  console.log(`📡 Connecting to: ${env.CLAWDBOT_URL || 'ws://127.0.0.1:18789'}`);
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
