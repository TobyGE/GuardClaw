// Agent Adapters — Tool name mappers, param mappers, display formatters, and response formatters
// for all supported agent backends (Claude Code, Gemini, Cursor, OpenCode).

// ─── Tool Name Mappers ──────────────────────────────────────────────────────

export function mapClaudeCodeTool(toolName) {
  const map = {
    Bash: 'exec',
    Edit: 'edit',
    Write: 'write',
    Read: 'read',
    Glob: 'glob',
    Grep: 'grep',
    Agent: 'agent_spawn',
    WebFetch: 'web_fetch',
    WebSearch: 'web_search',
    NotebookEdit: 'write',
    Skill: 'skill',
    EnterWorktree: 'worktree',
    EnterPlanMode: 'plan_mode',
    ExitPlanMode: 'plan_mode',
    TaskCreate: 'task',
    TaskUpdate: 'task',
    AskUserQuestion: 'ask_user',
  };
  return map[toolName] || toolName.toLowerCase();
}

export function mapClaudeCodeParams(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return {};
  switch (toolName) {
    case 'Bash': return { command: toolInput.command || '' };
    case 'Edit': return { file_path: toolInput.file_path, new_string: toolInput.new_string, old_string: toolInput.old_string };
    case 'Write': return { file_path: toolInput.file_path, content: toolInput.content };
    case 'Read': return { file_path: toolInput.file_path };
    case 'Glob': return { command: `glob ${toolInput.pattern || ''}`, pattern: toolInput.pattern, path: toolInput.path };
    case 'Grep': return { command: `grep ${toolInput.pattern || ''} ${toolInput.path || ''}`, pattern: toolInput.pattern, path: toolInput.path };
    case 'Agent': return { command: `agent_spawn [${toolInput.subagent_type || 'general'}] ${(toolInput.prompt || toolInput.description || '').slice(0, 200)}` };
    case 'WebFetch': return { command: `web_fetch ${toolInput.url || ''}`, url: toolInput.url };
    case 'WebSearch': return { command: `web_search ${toolInput.query || ''}`, query: toolInput.query };
    case 'NotebookEdit': return { file_path: toolInput.notebook_path, content: toolInput.new_source };
    case 'Skill': return { command: `skill ${toolInput.skill || ''} ${toolInput.args || ''}` };
    case 'EnterWorktree': return { command: `worktree ${toolInput.name || ''}`, dangerouslyDisableSandbox: toolInput.dangerouslyDisableSandbox };
    case 'ToolSearch': return { command: `tool_search ${toolInput.query || ''}`, query: toolInput.query };
    default: return toolInput;
  }
}

export function mapGeminiTool(toolName) {
  const map = {
    run_shell_command: 'exec',
    write_file: 'write',
    replace: 'edit',
    read_file: 'read',
    read_many_files: 'read',
    glob: 'glob',
    search_file_content: 'grep',
    list_directory: 'read',
    google_web_search: 'web_search',
    web_fetch: 'web_fetch',
    save_memory: 'write',
    write_todos: 'write',
    codebase_investigator: 'agent_spawn',
    grep_search: 'grep',
    generalist: 'agent_spawn',
  };
  return map[toolName] || toolName;
}

export function mapGeminiParams(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return {};
  switch (toolName) {
    case 'run_shell_command': return { command: toolInput.command || toolInput.cmd || '' };
    case 'write_file': return { file_path: toolInput.path || toolInput.file_path, content: toolInput.content };
    case 'replace': return { file_path: toolInput.path || toolInput.file_path, old_string: toolInput.old || toolInput.old_string, new_string: toolInput.new || toolInput.new_string };
    case 'read_file': return { file_path: toolInput.path || toolInput.file_path };
    case 'read_many_files': return { file_path: (toolInput.paths || []).join(', ') };
    case 'glob': return { pattern: toolInput.pattern, path: toolInput.directory || toolInput.path };
    case 'search_file_content': return { pattern: toolInput.query || toolInput.pattern, path: toolInput.path || toolInput.directory };
    case 'google_web_search': return { query: toolInput.query };
    case 'web_fetch': return { url: toolInput.url };
    default: return toolInput;
  }
}

export function mapCursorTool(toolName) {
  const map = {
    Shell: 'exec', shell: 'exec', run_terminal_command: 'exec',
    Write: 'write', write_to_file: 'write', create_file: 'write', WriteFile: 'write',
    Edit: 'edit', edit_file: 'edit', replace_in_file: 'edit',
    Read: 'read', read_file: 'read', ReadFile: 'read',
    Search: 'grep', grep_search: 'grep', codebase_search: 'grep',
    Grep: 'grep', Glob: 'glob', list_files: 'read', list_dir: 'read',
    web_search: 'web_search', WebSearch: 'web_search',
    web_fetch: 'web_fetch', WebFetch: 'web_fetch',
    Task: 'agent_spawn',
  };
  return map[toolName] || toolName;
}

export function mapCursorParams(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return {};
  if (toolInput.command) return { command: toolInput.command };
  if (toolInput.file_path) return toolInput;
  if (toolInput.path) return { file_path: toolInput.path, ...toolInput };
  return toolInput;
}

export function mapOpenCodeTool(toolName) {
  const map = {
    bash: 'exec',
    read: 'read',
    write: 'write',
    edit: 'edit',
    glob: 'glob',
    grep: 'grep',
    list: 'read',
    webfetch: 'web_fetch',
    websearch: 'web_search',
    patch: 'edit',
    todowrite: 'write',
    todoread: 'read',
    question: 'ask_user',
    skill: 'skill',
    lsp: 'lsp',
  };
  return map[toolName] || toolName;
}

export function mapOpenCodeParams(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return {};
  switch (toolName) {
    case 'bash': return { command: toolInput.command || '' };
    case 'read': return { file_path: toolInput.filePath || toolInput.file_path || '' };
    case 'write': return { file_path: toolInput.filePath || toolInput.file_path || '', content: toolInput.content || '' };
    case 'edit': return { file_path: toolInput.filePath || toolInput.file_path || '', old_string: toolInput.old_string || '', new_string: toolInput.new_string || '' };
    case 'glob': return { pattern: toolInput.pattern || toolInput.glob || '', path: toolInput.path || '.' };
    case 'grep': return { pattern: toolInput.pattern || toolInput.regex || '', path: toolInput.path || '.' };
    case 'webfetch': return { url: toolInput.url || '', command: `web_fetch ${toolInput.url || ''}` };
    case 'websearch': return { query: toolInput.query || '', command: `web_search ${toolInput.query || ''}` };
    case 'list': return { file_path: toolInput.path || toolInput.directory || '.' };
    case 'patch': return { file_path: toolInput.filePath || '', content: toolInput.patch || '' };
    default: return toolInput;
  }
}

// ─── Display Formatters ─────────────────────────────────────────────────────

function shorten(s, n = 100) {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n)}...` : str;
}

export function compactToolInput(toolName, params = {}) {
  switch (toolName) {
    case 'read':
    case 'write':
      return shorten(params.file_path || params.path || '');
    case 'edit':
      return shorten(params.file_path || params.path || '');
    case 'exec':
      return shorten(params.command || '', 120);
    case 'web_fetch':
      return shorten(params.url || '', 120);
    case 'web_search':
      return shorten(params.query || '', 120);
    case 'grep':
      return `"${shorten(params.pattern || '', 40)}" in ${shorten(params.path || '.', 80)}`;
    case 'glob':
      return `"${shorten(params.pattern || '', 40)}" in ${shorten(params.path || '.', 80)}`;
    case 'agent_spawn':
      return shorten(params.description || params.prompt || '', 120);
    case 'skill':
      return shorten(params.skill || params.command || '', 80);
    case 'tool_search':
      return shorten(params.query || '', 80);
    default:
      return shorten(JSON.stringify(params), 120);
  }
}

export function formatDisplayInput(toolName, params) {
  switch(toolName) {
    case 'exec': return params.command || '';
    case 'write': return (params.file_path || params.path || '?') + '\n' + (params.content || '').slice(0, 500);
    case 'edit': return (params.file_path || params.path || '?') + ' → ' + (params.old_string || params.oldText || '').slice(0, 200);
    case 'read': return params.file_path || params.path || JSON.stringify(params);
    case 'grep': return `grep "${params.pattern || ''}" ${params.path || ''}`;
    case 'glob': return `glob "${params.pattern || ''}" ${params.path || ''}`;
    case 'tool_search': return `search: ${params.query || ''}`;
    case 'web_fetch': return params.url || JSON.stringify(params);
    case 'web_search': return params.query || JSON.stringify(params);
    default: return JSON.stringify(params);
  }
}

// ─── Response Formatters (per-agent response shape) ─────────────────────────

/**
 * Format a response for Claude Code hooks.
 * CC expects { systemMessage?, hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }
 */
export function formatClaudeCodeResponse(decision, reason, { emitNotice = true } = {}) {
  return {
    ...(emitNotice ? { systemMessage: reason } : {}),
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision, // 'allow' | 'ask'
      permissionDecisionReason: reason,
    },
  };
}

/**
 * Format a response for Gemini hooks.
 * Gemini expects { decision, reason?, message? }
 */
export function formatGeminiResponse(decision, message) {
  return { decision, ...(decision === 'block' ? { reason: message } : {}), message };
}

/**
 * Format a response for Cursor hooks.
 * Cursor expects { permission, user_message? }
 */
export function formatCursorResponse(permission, userMessage) {
  return { permission, ...(userMessage ? { user_message: userMessage } : {}) };
}

/**
 * Format a response for OpenCode hooks.
 * OpenCode expects { decision, reason?, message? }
 */
export function formatOpenCodeResponse(decision, reason, message) {
  return { decision, ...(reason ? { reason } : {}), ...(message ? { message } : {}) };
}
