/**
 * syscall-judge.js — LLM-based anomaly detection for MCP server syscall logs.
 *
 * Receives dtrace syscall logs collected during a tool call execution window,
 * sends them to the LLM judge with the declared tool_input for comparison,
 * and returns a verdict: SAFE / WARNING / BLOCK.
 */

const SYSCALL_JUDGE_SYSTEM = `You are a security analyst reviewing system call logs from an MCP server process.

An MCP server is a tool plugin that runs locally on the user's machine. It receives tool call requests from an AI agent and returns results.

You will receive:
1. The MCP server name and its launch command
2. The declared tool call (what the agent asked the MCP server to do)
3. The actual syscall log captured by dtrace during execution

Your job: determine if the actual behavior matches the declared intent, or if there is suspicious activity.

RED FLAGS (verdict: BLOCK):
- Reading sensitive files (.ssh/, .aws/, .env, credentials, keys) that are unrelated to the declared tool call
- Network connections from a server that shouldn't need network access (e.g. a filesystem tool)
- Reading sensitive files AND making network connections (strong exfiltration signal)
- Spawning shell processes (bash, sh) or network tools (curl, wget, nc, ssh)
- Accessing files far outside the expected scope

YELLOW FLAGS (verdict: WARNING):
- Network connections from a server that needs network (e.g. API client) but to unexpected destinations
- File access outside the project directory but not to sensitive paths
- Spawning benign helper processes

SAFE:
- File access within the project directory matching the declared tool call
- Expected network access for API-based MCP servers
- No syscalls (idle period)

Output ONLY valid JSON:
{"verdict":"SAFE|WARNING|BLOCK","reason":"1-2 sentences explaining what happened and why this verdict"}`;

export class SyscallJudge {
  constructor(safeguardService) {
    this.safeguard = safeguardService;
  }

  /**
   * Analyze syscall logs for a tool call execution window.
   *
   * @param {object} params
   * @param {string} params.mcpName - MCP server name
   * @param {string} params.mcpCommand - MCP server launch command
   * @param {string} params.parentApp - Which agent launched it (Claude Desktop, etc.)
   * @param {string} params.toolName - Declared tool name (e.g. "mcp__notion__search")
   * @param {object} params.toolInput - Declared tool input parameters
   * @param {string[]} params.syscalls - Array of dtrace log lines
   * @returns {object} { verdict, reason, riskScore }
   */
  async analyze({ mcpName, mcpCommand, parentApp, toolName, toolInput, syscalls }) {
    if (!syscalls || syscalls.length === 0) {
      return { verdict: 'SAFE', reason: 'No syscalls recorded during execution window.', riskScore: 1 };
    }

    // Deduplicate and summarize to keep prompt short
    const summary = this._summarizeSyscalls(syscalls);

    const userPrompt = `MCP SERVER: ${mcpName}
COMMAND: ${mcpCommand}
LAUNCHED BY: ${parentApp}

DECLARED TOOL CALL: ${toolName}
TOOL INPUT: ${JSON.stringify(toolInput || {}).slice(0, 500)}

SYSCALL LOG (${syscalls.length} calls):
${summary}`;

    try {
      const result = await this._callLLM(userPrompt);
      return result;
    } catch (err) {
      console.error('[SyscallJudge] LLM call failed:', err.message);
      // Fail open for syscall judge — the pre-hook judge already handled blocking
      return { verdict: 'WARNING', reason: `Syscall judge unavailable: ${err.message}`, riskScore: 5 };
    }
  }

  /**
   * Summarize syscalls to fit in a reasonable prompt size.
   * Groups repeated patterns and caps output.
   */
  _summarizeSyscalls(syscalls) {
    const MAX_LINES = 50;

    // Count occurrences of each unique syscall pattern
    const counts = new Map();
    for (const line of syscalls) {
      // Normalize: remove specific PIDs for grouping
      const normalized = line.replace(/pid=\d+/, 'pid=X');
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }

    // Sort by count descending, then format
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const lines = [];

    for (const [pattern, count] of sorted) {
      if (lines.length >= MAX_LINES) {
        lines.push(`... and ${sorted.length - MAX_LINES} more unique patterns`);
        break;
      }
      lines.push(count > 1 ? `[${count}x] ${pattern}` : pattern);
    }

    return lines.join('\n');
  }

  /**
   * Call the LLM using the same backend as safeguard service.
   */
  async _callLLM(userPrompt) {
    const backend = this.safeguard.config.backend || this.safeguard.backend;
    const lmstudioUrl = this.safeguard.config.lmstudioUrl;

    let content;

    if (backend === 'lmstudio' || backend === 'built-in') {
      const url = backend === 'built-in'
        ? 'http://127.0.0.1:8081/v1/chat/completions'
        : `${lmstudioUrl}/chat/completions`;

      let modelToUse = this.safeguard.config.lmstudioModel;
      if (modelToUse === 'auto') {
        modelToUse = await this.safeguard.getFirstAvailableLMStudioModel();
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelToUse,
          messages: [
            { role: 'system', content: SYSCALL_JUDGE_SYSTEM },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.05,
          max_tokens: 200,
        }),
      });

      if (!response.ok) throw new Error(`LLM API error: ${response.status}`);
      const data = await response.json();
      content = data.choices[0].message.content;

    } else if (backend === 'ollama') {
      const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
      const model = process.env.OLLAMA_MODEL || 'llama3';

      const response = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSCALL_JUDGE_SYSTEM },
            { role: 'user', content: userPrompt },
          ],
          stream: false,
          options: { temperature: 0.05 },
        }),
      });

      if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
      const data = await response.json();
      content = data.message.content;

    } else {
      // Fallback: use heuristic only (no LLM call)
      return this._heuristicOnly(userPrompt);
    }

    return this._parseResponse(content);
  }

  /**
   * Parse LLM JSON response.
   */
  _parseResponse(content) {
    try {
      // Strip thinking tags if present
      const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');

      const parsed = JSON.parse(jsonMatch[0]);
      const verdict = (parsed.verdict || 'WARNING').toUpperCase();
      const reason = parsed.reason || 'No reason provided';

      const riskScore = verdict === 'BLOCK' ? 9
        : verdict === 'WARNING' ? 6
        : 1;

      return { verdict, reason, riskScore };
    } catch (err) {
      console.error('[SyscallJudge] Failed to parse LLM response:', content);
      return { verdict: 'WARNING', reason: 'Could not parse judge response', riskScore: 5 };
    }
  }

  /**
   * Pure heuristic fallback when no LLM is available.
   */
  _heuristicOnly(prompt) {
    const hasSensitiveRead = /\.ssh|\.aws|\.env|\.pem|\.key|credentials|secret/i.test(prompt);
    const hasNetwork = /CONNECT/i.test(prompt);
    const hasSuspiciousExec = /EXEC.*(?:curl|wget|nc|ncat|ssh|bash|sh)\b/i.test(prompt);

    if (hasSensitiveRead && hasNetwork) {
      return { verdict: 'BLOCK', reason: 'MCP server read sensitive files and made network connections — possible data exfiltration.', riskScore: 9 };
    }
    if (hasSuspiciousExec) {
      return { verdict: 'BLOCK', reason: 'MCP server spawned suspicious network/shell process.', riskScore: 9 };
    }
    if (hasNetwork) {
      return { verdict: 'WARNING', reason: 'MCP server made network connections.', riskScore: 6 };
    }
    if (hasSensitiveRead) {
      return { verdict: 'WARNING', reason: 'MCP server accessed sensitive files.', riskScore: 7 };
    }
    return { verdict: 'SAFE', reason: 'No suspicious syscall patterns detected.', riskScore: 1 };
  }
}
