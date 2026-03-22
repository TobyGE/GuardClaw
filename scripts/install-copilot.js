#!/usr/bin/env node
/**
 * GuardClaw — GitHub Copilot CLI integration installer
 *
 * Installs GuardClaw as a Copilot CLI extension at ~/.copilot/extensions/guardclaw/
 * The extension uses the @github/copilot-sdk to intercept tool calls via
 * onPreToolUse/onPostToolUse hooks.
 *
 * Usage: node scripts/install-copilot.js [--uninstall] [--port 3002]
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
const portIdx = args.indexOf('--port');
const port = portIdx !== -1 ? args[portIdx + 1] : '3002';

const extDir = path.join(os.homedir(), '.copilot', 'extensions', 'guardclaw');
const extFile = path.join(extDir, 'extension.mjs');
const configPath = path.join(os.homedir(), '.copilot', 'config.json');

// Extension source
const EXTENSION_SOURCE = `/**
 * GuardClaw Extension for GitHub Copilot CLI
 *
 * Intercepts tool calls via PreToolUse/PostToolUse hooks,
 * forwards them to GuardClaw for risk scoring, and enforces decisions.
 */

import { joinSession } from "@github/copilot-sdk/extension";

const GUARDCLAW_PORT = process.env.GUARDCLAW_PORT || "${port}";
const GUARDCLAW_URL = \`http://127.0.0.1:\${GUARDCLAW_PORT}\`;

async function postJSON(endpoint, body) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(\`\${GUARDCLAW_URL}\${endpoint}\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const session = await joinSession({
  hooks: {
    onSessionStart: async (input) => {
      await session.log("GuardClaw monitoring active", { ephemeral: true });
    },

    onPreToolUse: async (input) => {
      const gcBody = {
        session_id: \`copilot:\${input.timestamp || Date.now()}\`,
        cwd: input.cwd || "",
        hook_event_name: "PreToolUse",
        permission_mode: "default",
        tool_name: mapToolName(input.toolName),
        tool_input: input.toolArgs || {},
      };

      const response = await postJSON("/api/hooks/pre-tool-use", gcBody);

      if (!response) {
        return { permissionDecision: "allow" };
      }

      const hso = response.hookSpecificOutput || {};
      const decision = hso.permissionDecision || "allow";
      const reason = hso.permissionDecisionReason || "";

      if (decision === "allow") {
        if (response.systemMessage) {
          await session.log(response.systemMessage, { ephemeral: true });
        }
        return { permissionDecision: "allow" };
      }

      if (decision === "block") {
        await session.log(\`GuardClaw BLOCKED: \${reason}\`, { level: "error" });
        return {
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        };
      }

      if (response.systemMessage) {
        await session.log(response.systemMessage, { level: "warning" });
      }
      return {
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      };
    },

    onPostToolUse: async (input) => {
      const gcBody = {
        session_id: \`copilot:\${input.timestamp || Date.now()}\`,
        cwd: input.cwd || "",
        hook_event_name: "PostToolUse",
        tool_name: mapToolName(input.toolName),
        tool_input: input.toolArgs || {},
        tool_output: input.toolResult || "",
      };
      postJSON("/api/hooks/post-tool-use", gcBody);
    },
  },
  tools: [],
});

function mapToolName(name) {
  const map = {
    bash: "Bash", shell: "Bash", create: "Write", edit: "Edit",
    read: "Read", grep: "Grep", glob: "Glob", list_dir: "Bash",
    web_fetch: "WebFetch", web_search: "WebSearch",
  };
  return map[name] || name;
}
`;

try {
  if (uninstall) {
    // Remove extension
    if (fs.existsSync(extDir)) {
      fs.rmSync(extDir, { recursive: true });
    }

    // Clean up config.json hooks if any command-based hooks were left
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.hooks) {
        for (const event of ['PreToolUse', 'PostToolUse']) {
          if (Array.isArray(config.hooks[event])) {
            config.hooks[event] = config.hooks[event].filter(g =>
              !g?.hooks?.some(h => h.command?.includes('copilot-hook.sh'))
            );
            if (config.hooks[event].length === 0) delete config.hooks[event];
          }
        }
        if (Object.keys(config.hooks).length === 0) delete config.hooks;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      }
    }

    console.log('');
    console.log('🗑️  GuardClaw extension removed from Copilot CLI.');
    console.log(`   Removed: ${extDir}`);
    console.log('');
  } else {
    // Install extension
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(extFile, EXTENSION_SOURCE);

    // Enable experimental mode (required for extensions) and clean up old hooks
    const config = fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
      : {};
    config.experimental = true;
    if (config.hooks) {
      for (const event of ['PreToolUse', 'PostToolUse']) {
        if (Array.isArray(config.hooks[event])) {
          config.hooks[event] = config.hooks[event].filter(g =>
            !g?.hooks?.some(h => h.command?.includes('copilot-hook.sh'))
          );
          if (config.hooks[event].length === 0) delete config.hooks[event];
        }
      }
      if (Object.keys(config.hooks).length === 0) delete config.hooks;
    }
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    console.log('');
    console.log('🛡️  GuardClaw installed for GitHub Copilot CLI!');
    console.log('');
    console.log(`   Extension: ${extFile}`);
    console.log(`   GuardClaw: http://127.0.0.1:${port}`);
    console.log('');
    console.log('   All Copilot CLI sessions will now be monitored.');
    console.log('   Make sure GuardClaw is running: cd ~/guardclaw && npm start');
    console.log('');
    console.log('   To uninstall: node scripts/install-copilot.js --uninstall');
    console.log('');
  }
} catch (err) {
  console.error('❌ Failed:', err.message);
  process.exit(1);
}
