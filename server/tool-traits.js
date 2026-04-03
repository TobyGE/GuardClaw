// Tool trait classification for risk scoring
// Each tool has static properties that influence pipeline behavior.

const TOOL_TRAITS = {
  // Execution — can run arbitrary code, network access, destructive
  exec:         { readOnly: false, destructive: true,  networkCapable: true,  canExfiltrate: true  },

  // File operations
  read:         { readOnly: true,  destructive: false, networkCapable: false, canExfiltrate: false },
  write:        { readOnly: false, destructive: true,  networkCapable: false, canExfiltrate: false },
  edit:         { readOnly: false, destructive: true,  networkCapable: false, canExfiltrate: false },

  // Search — read-only, no side effects
  glob:         { readOnly: true,  destructive: false, networkCapable: false, canExfiltrate: false },
  grep:         { readOnly: true,  destructive: false, networkCapable: false, canExfiltrate: false },

  // Network — can send data out
  web_fetch:    { readOnly: true,  destructive: false, networkCapable: true,  canExfiltrate: true  },
  web_search:   { readOnly: true,  destructive: false, networkCapable: true,  canExfiltrate: false },

  // Agent — spawns sub-process with full permissions
  agent_spawn:  { readOnly: false, destructive: true,  networkCapable: true,  canExfiltrate: true  },

  // Workspace
  worktree:     { readOnly: false, destructive: false, networkCapable: false, canExfiltrate: false },

  // UI / planning — no side effects
  plan_mode:    { readOnly: true,  destructive: false, networkCapable: false, canExfiltrate: false },
  task:         { readOnly: true,  destructive: false, networkCapable: false, canExfiltrate: false },
  ask_user:     { readOnly: true,  destructive: false, networkCapable: false, canExfiltrate: false },

  // Skills — can execute arbitrary logic
  skill:        { readOnly: false, destructive: true,  networkCapable: true,  canExfiltrate: true  },

  // Canvas
  canvas:       { readOnly: false, destructive: false, networkCapable: false, canExfiltrate: false },

  // Memory / session (OpenClaw)
  memory_search: { readOnly: true,  destructive: false, networkCapable: false, canExfiltrate: false },
  memory_get:    { readOnly: true,  destructive: false, networkCapable: false, canExfiltrate: false },
  session_status: { readOnly: true, destructive: false, networkCapable: false, canExfiltrate: false },
  sessions_list:  { readOnly: true, destructive: false, networkCapable: false, canExfiltrate: false },
  sessions_history: { readOnly: true, destructive: false, networkCapable: false, canExfiltrate: false },
  image:        { readOnly: true,  destructive: false, networkCapable: false, canExfiltrate: false },
  process:      { readOnly: true,  destructive: false, networkCapable: false, canExfiltrate: false },
  tts:          { readOnly: true,  destructive: false, networkCapable: false, canExfiltrate: false },
};

// Default for unknown tools — assume worst case
const DEFAULT_TRAITS = { readOnly: false, destructive: false, networkCapable: false, canExfiltrate: false };

export function getToolTraits(toolName) {
  return TOOL_TRAITS[toolName] || DEFAULT_TRAITS;
}

/**
 * Compute a risk floor from tool traits + session signals.
 * Only elevates scores when session signals are active — without signals,
 * the existing rule-based/LLM scoring handles everything correctly.
 *
 * This prevents false positives like "npm install" (exec tool, safe fast-path)
 * being elevated to floor 5 just because exec is destructive+networkCapable.
 *
 * @param {string} toolName
 * @param {object} sessionSignals - accumulated signals from SessionSignalTracker
 * @returns {number} risk floor (1-10), only > 1 when session signals warrant it
 */
export function traitBasedFloor(toolName, sessionSignals = {}) {
  const t = getToolTraits(toolName);
  const hasSignals = sessionSignals.sensitiveDataAccessed ||
                     sessionSignals.credentialRead ||
                     sessionSignals.escalationAttempted;

  // No active signals → no elevation (let rules/LLM handle it)
  if (!hasSignals) return 1;

  // Network-capable/exfiltrable after sensitive data was accessed → floor 7
  if (t.canExfiltrate && sessionSignals.sensitiveDataAccessed) return 7;

  // Network-capable (non-exfiltrable) after sensitive access → floor 4
  if (t.networkCapable && sessionSignals.sensitiveDataAccessed) return 4;

  // Destructive after credential read → floor 5
  if (t.destructive && sessionSignals.credentialRead) return 5;

  // Destructive after any sensitive access → floor 3
  if (t.destructive && sessionSignals.sensitiveDataAccessed) return 3;

  return 1;
}
