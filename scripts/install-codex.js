#!/usr/bin/env node
/**
 * GuardClaw — Codex CLI integration installer
 *
 * Writes GuardClaw hooks to ~/.codex/hooks.json.
 * Codex uses command-based hooks (stdin/stdout) rather than HTTP.
 *
 * Usage: node scripts/install-codex.js [--uninstall] [--port 3002]
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
const portIdx = args.indexOf('--port');
const port = portIdx !== -1 ? args[portIdx + 1] : '3002';

const codexDir = path.join(os.homedir(), '.codex');
const hooksPath = path.join(codexDir, 'hooks.json');
const hookScript = path.join(__dirname, 'codex-hook.sh');

const hookEntry = (event) => ({
  matcher: '',
  hooks: [{
    type: 'command',
    command: hookScript,
    timeout: event === 'PreToolUse' ? 310 : 10,
  }],
});

const GUARDCLAW_HOOKS = {
  PreToolUse:       [hookEntry('PreToolUse')],
  UserPromptSubmit: [hookEntry('UserPromptSubmit')],
  Stop:             [hookEntry('Stop')],
};

function isGuardClawHook(group) {
  return group?.hooks?.some(h => h.command?.includes('codex-hook.sh'));
}

try {
  if (!fs.existsSync(codexDir)) fs.mkdirSync(codexDir, { recursive: true });

  let config = {};
  if (fs.existsSync(hooksPath)) {
    config = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  }
  if (!config.hooks) config.hooks = {};

  if (uninstall) {
    for (const event of Object.keys(GUARDCLAW_HOOKS)) {
      if (Array.isArray(config.hooks[event])) {
        config.hooks[event] = config.hooks[event].filter(g => !isGuardClawHook(g));
        if (config.hooks[event].length === 0) delete config.hooks[event];
      }
    }
    if (Object.keys(config.hooks).length === 0) delete config.hooks;
    fs.writeFileSync(hooksPath, JSON.stringify(config, null, 2) + '\n');
    console.log('\n🗑️  GuardClaw hooks removed from Codex.');
    console.log(`   File: ${hooksPath}\n`);
  } else {
    // Make hook script executable
    fs.chmodSync(hookScript, 0o755);

    // Clean reinstall
    for (const event of Object.keys(GUARDCLAW_HOOKS)) {
      if (Array.isArray(config.hooks[event])) {
        config.hooks[event] = config.hooks[event].filter(g => !isGuardClawHook(g));
      }
    }

    for (const [event, groups] of Object.entries(GUARDCLAW_HOOKS)) {
      if (!config.hooks[event]) config.hooks[event] = [];
      config.hooks[event].push(...groups);
    }

    fs.writeFileSync(hooksPath, JSON.stringify(config, null, 2) + '\n');

    console.log('\n🛡️  GuardClaw installed for Codex!');
    console.log(`\n   Hooks: ${hooksPath}`);
    console.log(`   Script: ${hookScript}`);
    console.log(`   GuardClaw: http://127.0.0.1:${port}`);
    console.log('\n   All Codex sessions will now be monitored.');
    console.log('   Make sure GuardClaw is running: cd ~/guardclaw && npm start');
    console.log('\n   To uninstall: node scripts/install-codex.js --uninstall\n');
  }
} catch (err) {
  console.error('❌ Failed:', err.message);
  process.exit(1);
}
