// Agent Permissions — Layer 1 of the safety pipeline.
// Reads each agent's own permission config to check if a tool call
// is already allowed by the agent. If so, GuardClaw skips AI evaluation.
//
// Supported agents: Claude Code, Copilot CLI, Gemini CLI, Cursor, OpenCode, Codex

import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── GC tool name → CC tool name mapping (reverse of mapClaudeCodeTool) ────
const GC_TO_CC = {
  exec: 'Bash',
  edit: 'Edit',
  write: 'Write',
  read: 'Read',
  glob: 'Glob',
  grep: 'Grep',
  agent_spawn: 'Agent',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
  skill: 'Skill',
  worktree: 'EnterWorktree',
  plan_mode: 'EnterPlanMode',
  task: 'TaskCreate',
  ask_user: 'AskUserQuestion',
};

// ─── Config file paths per agent type ──────────────────────────────────────
const CONFIG_PATHS = {
  'claude-code': () => path.join(os.homedir(), '.claude', 'settings.json'),
  'copilot':     () => path.join(os.homedir(), '.claude', 'settings.json'), // shares CC config
  'gemini':      () => path.join(os.homedir(), '.gemini', 'settings.json'),
  'cursor':      () => path.join(os.homedir(), '.cursor', 'cli-config.json'),
  'opencode':    () => 'opencode.json', // project-local
  'codex':       () => path.join(os.homedir(), '.codex', 'config.toml'),
};

// ─── AgentPermissionChecker ────────────────────────────────────────────────

export class AgentPermissionChecker {
  constructor() {
    this.cache = new Map(); // agentType → { config, mtime, loadedAt }
    this.CACHE_TTL = 30_000; // 30 seconds
  }

  /**
   * Check if the agent's own config allows this tool call.
   * @param {string} sessionKey - e.g. 'claude-code:abc123'
   * @param {string} gcToolName - GuardClaw tool name (exec, read, write, etc.)
   * @param {object} gcParams - tool parameters
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkAllows(sessionKey, gcToolName, gcParams) {
    const agentType = this._getAgentType(sessionKey);
    if (!agentType) return { allowed: false };

    const allowPatterns = this._loadAllowPatterns(agentType);
    if (!allowPatterns || allowPatterns.length === 0) return { allowed: false };

    for (const pattern of allowPatterns) {
      if (this._matchesPattern(pattern, gcToolName, gcParams, agentType)) {
        return { allowed: true, reason: `${pattern}` };
      }
    }
    return { allowed: false };
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  _getAgentType(sessionKey) {
    if (!sessionKey) return null;
    const prefix = sessionKey.split(':')[0];
    // Map sessionKey prefixes to agent types
    const map = {
      'claude-code': 'claude-code',
      'copilot': 'copilot',
      'gemini': 'gemini',
      'cursor': 'cursor',
      'opencode': 'opencode',
      'codex': 'codex',
    };
    return map[prefix] || null;
  }

  /**
   * Load and cache allow patterns from agent config file.
   * Returns an array of pattern strings, or null if unavailable.
   */
  _loadAllowPatterns(agentType) {
    const pathFn = CONFIG_PATHS[agentType];
    if (!pathFn) return null;
    const configPath = pathFn();

    // Check cache
    const cached = this.cache.get(agentType);
    if (cached && (Date.now() - cached.loadedAt) < this.CACHE_TTL) {
      // Quick mtime check
      try {
        const stat = fs.statSync(configPath);
        if (stat.mtimeMs === cached.mtime) return cached.patterns;
      } catch {
        return cached.patterns; // file gone but cache still valid within TTL
      }
    }

    // Load fresh
    try {
      const stat = fs.statSync(configPath);
      const raw = fs.readFileSync(configPath, 'utf8');
      const patterns = this._parseConfig(agentType, raw);
      this.cache.set(agentType, { patterns, mtime: stat.mtimeMs, loadedAt: Date.now() });
      return patterns;
    } catch {
      // File doesn't exist or parse error — no allows
      return null;
    }
  }

  /**
   * Parse agent config into an array of allow pattern strings.
   */
  _parseConfig(agentType, raw) {
    switch (agentType) {
      case 'claude-code':
      case 'copilot':
        return this._parseCCConfig(raw);
      case 'gemini':
        return this._parseGeminiConfig(raw);
      case 'cursor':
        return this._parseCursorConfig(raw);
      case 'opencode':
        return this._parseOpenCodeConfig(raw);
      case 'codex':
        return this._parseCodexConfig(raw);
      default:
        return null;
    }
  }

  // ─── Per-agent parsers ──────────────────────────────────────────────────────

  /**
   * Claude Code: ~/.claude/settings.json
   * { "permissions": { "allow": ["Bash(git *)", "Read", "Glob"] } }
   */
  _parseCCConfig(raw) {
    try {
      const config = JSON.parse(raw);
      const allows = config?.permissions?.allow;
      if (!Array.isArray(allows)) return [];
      return allows.filter(a => typeof a === 'string');
    } catch { return []; }
  }

  /**
   * Gemini CLI: ~/.gemini/settings.json
   * May have tool permissions in various formats. Extract allow patterns.
   */
  _parseGeminiConfig(raw) {
    try {
      const config = JSON.parse(raw);
      // Gemini settings.json may have sandbox/permissions config
      // Format: { "toolPermissions": { "allow": [...] } } or similar
      const allows = config?.toolPermissions?.allow || config?.permissions?.allow;
      if (Array.isArray(allows)) return allows.filter(a => typeof a === 'string');
      return [];
    } catch { return []; }
  }

  /**
   * Cursor: ~/.cursor/cli-config.json
   * { "permissions": { "allow": ["Shell(git *)", "Read"] } }
   */
  _parseCursorConfig(raw) {
    try {
      const config = JSON.parse(raw);
      const allows = config?.permissions?.allow;
      if (!Array.isArray(allows)) return [];
      // Map Cursor tool names to CC-style: Shell → Bash
      return allows.map(a => typeof a === 'string' ? a.replace(/^Shell\b/, 'Bash') : null).filter(Boolean);
    } catch { return []; }
  }

  /**
   * OpenCode: opencode.json
   * { "permission": { "bash": { "git *": "allow", "npm *": "ask" } } }
   */
  _parseOpenCodeConfig(raw) {
    try {
      const config = JSON.parse(raw);
      const perms = config?.permission;
      if (!perms || typeof perms !== 'object') return [];
      const allows = [];
      // bash section
      if (perms.bash && typeof perms.bash === 'object') {
        for (const [pattern, decision] of Object.entries(perms.bash)) {
          if (decision === 'allow') {
            allows.push(`Bash(${pattern})`);
          }
        }
      }
      // Other tool sections (read, write, etc.)
      for (const [tool, rules] of Object.entries(perms)) {
        if (tool === 'bash') continue;
        if (typeof rules === 'string' && rules === 'allow') {
          // Top-level tool allow
          const ccName = tool.charAt(0).toUpperCase() + tool.slice(1);
          allows.push(ccName);
        }
      }
      return allows;
    } catch { return []; }
  }

  /**
   * Codex: ~/.codex/config.toml
   * Codex uses project-level trust, not per-tool allows.
   * We can't meaningfully extract allow patterns.
   */
  _parseCodexConfig(_raw) {
    // Codex doesn't have per-tool allow patterns — always fall through to Layer 2/3
    return [];
  }

  // ─── Pattern matching ─────────────────────────────────────────────────────

  /**
   * Check if a CC-style allow pattern matches the tool call.
   *
   * Pattern formats:
   *   "Read"           → matches tool 'read' (any params)
   *   "Bash(git *)"    → matches tool 'exec' where command starts with 'git '
   *   "Bash(*)"        → matches any exec command
   *   "Write(src/**)"  → matches 'write' where file_path matches glob
   */
  _matchesPattern(pattern, gcToolName, gcParams, _agentType) {
    // Parse pattern: "ToolName" or "ToolName(argPattern)"
    const m = pattern.match(/^(\w+)(?:\((.+)\))?$/);
    if (!m) return false;

    const ccToolName = m[1];    // e.g. "Bash", "Read"
    const argPattern = m[2];    // e.g. "git *", "src/**", undefined

    // Map CC tool name to GC tool name
    const expectedGcTool = this._ccToGc(ccToolName);
    if (!expectedGcTool || expectedGcTool !== gcToolName) return false;

    // No arg pattern → matches any invocation of this tool
    if (!argPattern) return true;

    // Match arg pattern against the relevant param
    const argValue = this._getArgValue(gcToolName, gcParams);
    if (!argValue) return false;

    return this._wildcardMatch(argPattern, argValue);
  }

  /**
   * CC tool name → GC tool name
   */
  _ccToGc(ccToolName) {
    const map = {
      Bash: 'exec', Shell: 'exec',
      Edit: 'edit',
      Write: 'write',
      Read: 'read',
      Glob: 'glob',
      Grep: 'grep',
      Agent: 'agent_spawn',
      WebFetch: 'web_fetch',
      WebSearch: 'web_search',
      Skill: 'skill',
    };
    return map[ccToolName] || null;
  }

  /**
   * Get the argument string to match against the pattern.
   */
  _getArgValue(gcToolName, gcParams) {
    if (!gcParams) return null;
    switch (gcToolName) {
      case 'exec': return gcParams.command || '';
      case 'read': return gcParams.file_path || gcParams.path || '';
      case 'write': return gcParams.file_path || '';
      case 'edit': return gcParams.file_path || '';
      case 'glob': return gcParams.pattern || gcParams.path || '';
      case 'grep': return gcParams.pattern || gcParams.path || '';
      case 'web_fetch': return gcParams.url || '';
      case 'web_search': return gcParams.query || '';
      default: return JSON.stringify(gcParams);
    }
  }

  /**
   * Simple wildcard matching: * matches any sequence within a path segment,
   * ** matches across path segments.
   */
  _wildcardMatch(pattern, value) {
    // Convert glob-like pattern to regex
    let re = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex special chars (except * and ?)
      .replace(/\*\*/g, '⟨DOUBLESTAR⟩')       // placeholder for **
      .replace(/\*/g, '.*')                     // * → match anything
      .replace(/⟨DOUBLESTAR⟩/g, '.*')          // ** → match anything (including /)
      .replace(/\?/g, '.');                     // ? → match single char

    try {
      return new RegExp(`^${re}$`).test(value);
    } catch {
      return false;
    }
  }
}

export const agentPermissions = new AgentPermissionChecker();
