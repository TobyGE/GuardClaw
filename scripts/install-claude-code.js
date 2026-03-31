#!/usr/bin/env node
/**
 * GuardClaw — Claude Code integration installer
 * 
 * Adds GuardClaw hooks to ~/.claude/settings.json so all Claude Code
 * sessions are monitored automatically.
 * 
 * Usage: node scripts/install-claude-code.js [--uninstall] [--port 3002]
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
const portIdx = args.indexOf('--port');
const port = portIdx !== -1 ? args[portIdx + 1] : '3002';

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
const claudeDir = path.join(os.homedir(), '.claude');

const GUARDCLAW_HOOKS = {
  PreToolUse: [{
    matcher: '',
    hooks: [{
      type: 'http',
      url: `http://127.0.0.1:${port}/api/hooks/pre-tool-use`,
      timeout: 300,
      statusMessage: '⏳ GuardClaw evaluating...',
    }],
  }],
  PostToolUse: [{
    matcher: '',
    hooks: [{
      type: 'http',
      url: `http://127.0.0.1:${port}/api/hooks/post-tool-use`,
      timeout: 10,
    }],
  }],
  Stop: [{
    matcher: '',
    hooks: [{
      type: 'http',
      url: `http://127.0.0.1:${port}/api/hooks/stop`,
      timeout: 10,
    }],
  }],
  UserPromptSubmit: [{
    matcher: '',
    hooks: [{
      type: 'http',
      url: `http://127.0.0.1:${port}/api/hooks/user-prompt`,
      timeout: 5,
    }],
  }],
};

const GUARDCLAW_HOOK_URLS = [
  '/api/hooks/pre-tool-use',
  '/api/hooks/post-tool-use',
  '/api/hooks/stop',
  '/api/hooks/user-prompt',
];

function isGuardClawHook(hookGroup) {
  return hookGroup?.hooks?.some(h => GUARDCLAW_HOOK_URLS.some(u => h.url?.includes(u)));
}

try {
  // Ensure ~/.claude/ exists
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  // Load existing settings
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }

  if (!settings.hooks) settings.hooks = {};

  if (uninstall) {
    // Remove GuardClaw hooks
    for (const event of ['PreToolUse', 'PostToolUse', 'Stop', 'UserPromptSubmit']) {
      if (Array.isArray(settings.hooks[event])) {
        settings.hooks[event] = settings.hooks[event].filter(g => !isGuardClawHook(g));
        if (settings.hooks[event].length === 0) delete settings.hooks[event];
      }
    }
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    console.log('');
    console.log('🗑️  GuardClaw hooks removed from Claude Code.');
    console.log(`   File: ${settingsPath}`);
    console.log('');
  } else {
    // Remove any existing GuardClaw hooks first (clean reinstall)
    for (const event of ['PreToolUse', 'PostToolUse', 'Stop', 'UserPromptSubmit']) {
      if (Array.isArray(settings.hooks[event])) {
        settings.hooks[event] = settings.hooks[event].filter(g => !isGuardClawHook(g));
      }
    }

    // Add GuardClaw hooks
    for (const [event, hookGroups] of Object.entries(GUARDCLAW_HOOKS)) {
      if (!settings.hooks[event]) settings.hooks[event] = [];
      settings.hooks[event].push(...hookGroups);
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

    console.log('');
    console.log('🛡️  GuardClaw installed for Claude Code!');
    console.log('');
    console.log(`   Settings: ${settingsPath}`);
    console.log(`   GuardClaw: http://127.0.0.1:${port}`);
    console.log('');
    console.log('   All Claude Code sessions will now be monitored.');
    console.log('   Make sure GuardClaw is running: cd ~/guardclaw && npm start');
    console.log('');
    console.log('   To uninstall: node scripts/install-claude-code.js --uninstall');
    console.log('');
  }
} catch (err) {
  console.error('❌ Failed:', err.message);
  process.exit(1);
}
