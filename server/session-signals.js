// Session-level signal accumulator for safety pipeline.
// Tracks security-relevant state across tool calls within a session,
// enabling context-aware risk scoring (e.g., reading credentials then
// attempting network access should raise the risk floor).

const SENSITIVE_PATH_PATTERNS = [
  /[/~]\.ssh\//,
  /[/~]\.aws\//,
  /[/~]\.gnupg\//,
  /[/~]\.config\/gcloud\//,
  /[/~]\.azure\//,
  /[/~]\.kube\/config/,
  /[/~]\.docker\/config\.json/,
  /\/etc\/(passwd|shadow|sudoers)/,
  /[/~]\.env(?:\.|$)/,
  /[/~]\.netrc/,
  /[/~]\.npmrc/,
  /[/~]\.pypirc/,
  /[/~]\.gem\/credentials/,
  /[/~]\.config\/gh\/hosts\.yml/,
  /credentials\.json/,
  /service[_-]?account.*\.json/,
  /[/~]\.terraform\.d\/credentials/,
  /id_rsa|id_ed25519|id_ecdsa/,
];

const CREDENTIAL_COMMANDS = [
  /\bcat\s+.*\.(pem|key|crt|cert)\b/,
  /\baws\s+configure\b/,
  /\bgcloud\s+auth\b/,
  /\bkubectl\s+config\s+view\b/,
];

const EXFILTRATION_COMMANDS = [
  /\bcurl\b/,
  /\bwget\b/,
  /\bnc\b|\bncat\b|\bnetcat\b/,
  /\bscp\b/,
  /\brsync\b.*@/,
  /\bssh\b.*@/,
  /\bftp\b/,
  /\bsendmail\b/,
];

export class SessionSignalTracker {
  constructor() {
    this.sessions = new Map(); // sessionKey → signals object
    this.maxSessions = 200;
  }

  /**
   * Get or create signal state for a session.
   */
  getSignals(sessionKey) {
    if (!sessionKey) return this._emptySignals();
    if (!this.sessions.has(sessionKey)) {
      this.sessions.set(sessionKey, this._emptySignals());
      this._evictOldest();
    }
    return this.sessions.get(sessionKey);
  }

  /**
   * User approved a high-risk operation — reduce cumulative risk.
   * Approval means the user is aware, so the risk is acknowledged.
   */
  recordApproval(sessionKey, riskScore) {
    if (!sessionKey) return;
    const sig = this.sessions.get(sessionKey);
    if (!sig) return;
    // Refund the risk spent by the approved operation
    const refund = riskScore >= 4 ? (riskScore - 3) : 0;
    sig.cumulativeRisk = Math.max(0, sig.cumulativeRisk - refund);
    if (sig.cumulativeRisk < sig.riskBudget) {
      sig.budgetExhausted = false;
    }
  }

  /**
   * User sent a new prompt — decay the budget.
   * New user message = user is engaged, partially reset accumulated risk.
   */
  decayBudgetOnNewPrompt(sessionKey) {
    if (!sessionKey) return;
    const sig = this.sessions.get(sessionKey);
    if (!sig) return;
    // Halve cumulative risk on each new user message
    sig.cumulativeRisk = Math.floor(sig.cumulativeRisk / 2);
    if (sig.cumulativeRisk < sig.riskBudget) {
      sig.budgetExhausted = false;
    }
    sig.lastBudgetResetTime = Date.now();
  }

  /**
   * Store user intent for a session (called from UserPromptSubmit).
   */
  setIntent(sessionKey, intent) {
    if (!sessionKey || !intent) return;
    const sig = this.getSignals(sessionKey);
    sig.intent = intent;
    sig.intentSetAt = Date.now();
  }

  /**
   * Record a user prompt for session context.
   */
  addPrompt(sessionKey, promptText) {
    if (!sessionKey || !promptText) return;
    const sig = this.getSignals(sessionKey);
    sig.promptHistory.push({ text: promptText.slice(0, 500), timestamp: Date.now() });
    // Keep last 20 prompts (cloud models have large context windows)
    if (sig.promptHistory.length > 20) sig.promptHistory.shift();
  }

  /**
   * Get session context for intent classification:
   * recent prompts + recent tool calls summary.
   */
  getSessionContext(sessionKey, toolHistoryStore) {
    if (!sessionKey) return null;
    const sig = this.sessions.get(sessionKey);
    if (!sig) return null;

    const prompts = sig.promptHistory || [];
    const tools = toolHistoryStore?.get(sessionKey) || [];

    // Build a compact timeline
    const timeline = [];

    // Merge prompts and tools by timestamp
    let pi = 0, ti = 0;
    const recentTools = tools.slice(-30);
    while (pi < prompts.length || ti < recentTools.length) {
      const pTime = pi < prompts.length ? prompts[pi].timestamp : Infinity;
      const tTime = ti < recentTools.length ? (recentTools[ti].timestamp || 0) : Infinity;
      if (pTime <= tTime && pi < prompts.length) {
        timeline.push(`[User] ${prompts[pi].text}`);
        pi++;
      } else if (ti < recentTools.length) {
        const t = recentTools[ti];
        const snippet = (t.resultSnippet || '').slice(0, 60);
        timeline.push(`[Tool] ${t.toolName}: ${snippet}`);
        ti++;
      } else break;
    }

    return timeline.length > 0 ? timeline.join('\n') : null;
  }

  /**
   * Get current intent for a session.
   */
  getIntent(sessionKey) {
    if (!sessionKey) return null;
    const sig = this.sessions.get(sessionKey);
    return sig?.intent || null;
  }

  _emptySignals() {
    return {
      sensitiveDataAccessed: false,  // read a credential/secret file
      credentialRead: false,         // specifically read a credential (key, token)
      destructiveActionTaken: false,  // rm, git push --force, etc.
      networkUsed: false,            // curl, wget, web_fetch, etc.
      escalationAttempted: false,    // sudo, chmod +s, etc.
      sensitiveFiles: [],            // which sensitive files were accessed
      toolCount: 0,                  // total tool calls in this session
      highRiskCount: 0,              // how many scored >= 7
      lastToolTime: 0,
      intent: null,                  // user intent from prompt classification
      intentSetAt: 0,
      promptHistory: [],              // recent user prompts [{text, timestamp}]
      // Risk budget: accumulated risk across the session
      cumulativeRisk: 0,             // sum of WARNING+ risk (score >= 4)
      riskBudget: 50,                // max cumulative risk before tightening
      budgetExhausted: false,        // true when cumulativeRisk >= riskBudget
      lastBudgetResetTime: Date.now(),
    };
  }

  /**
   * Update signals after a tool call is evaluated.
   * Call this AFTER scoring — it records what happened so
   * the NEXT tool call in this session gets a raised floor.
   *
   * @param {string} sessionKey
   * @param {string} toolName
   * @param {object} params - tool parameters
   * @param {object} analysis - the scoring result { riskScore, ... }
   */
  recordToolCall(sessionKey, toolName, params, analysis) {
    if (!sessionKey) return;
    const sig = this.getSignals(sessionKey);
    sig.toolCount++;
    sig.lastToolTime = Date.now();

    if (analysis?.riskScore >= 7) sig.highRiskCount++;

    // Time decay: if last tool was > 5 min ago, halve the budget
    const timeSinceLastTool = sig.lastToolTime > 0 ? (Date.now() - sig.lastToolTime) : 0;
    if (timeSinceLastTool > 5 * 60 * 1000 && sig.cumulativeRisk > 0) {
      sig.cumulativeRisk = Math.floor(sig.cumulativeRisk / 2);
      if (sig.cumulativeRisk < sig.riskBudget) sig.budgetExhausted = false;
    }

    // Only WARNING+ (score >= 4) accumulates risk. SAFE operations are free.
    const score = analysis?.riskScore || 1;
    if (score >= 4) {
      const riskSpent = score - 3; // score 4 = 1 risk, score 9 = 6 risk
      sig.cumulativeRisk += riskSpent;
      if (sig.cumulativeRisk >= sig.riskBudget) {
        sig.budgetExhausted = true;
      }
    }

    // Detect sensitive file access
    this._checkSensitiveAccess(sig, toolName, params);

    // Detect credential reads
    this._checkCredentialRead(sig, toolName, params);

    // Detect network usage
    this._checkNetworkUsage(sig, toolName, params);

    // Detect destructive actions
    this._checkDestructive(sig, toolName, params);

    // Detect escalation
    this._checkEscalation(sig, toolName, params);
  }

  _checkSensitiveAccess(sig, toolName, params) {
    const pathsToCheck = [];

    if (toolName === 'read' || toolName === 'Read') {
      pathsToCheck.push(params?.file_path, params?.path);
    } else if (toolName === 'exec' || toolName === 'Bash') {
      const cmd = params?.command || '';
      // cat/head/tail/less of sensitive files
      const fileMatch = cmd.match(/\b(?:cat|head|tail|less|more|bat)\s+(.+)/);
      if (fileMatch) pathsToCheck.push(fileMatch[1].trim());
    } else if (toolName === 'glob' || toolName === 'Glob' || toolName === 'grep' || toolName === 'Grep') {
      pathsToCheck.push(params?.path);
    }

    for (const p of pathsToCheck) {
      if (!p) continue;
      for (const re of SENSITIVE_PATH_PATTERNS) {
        if (re.test(p)) {
          sig.sensitiveDataAccessed = true;
          if (!sig.sensitiveFiles.includes(p)) {
            sig.sensitiveFiles.push(p);
            if (sig.sensitiveFiles.length > 20) sig.sensitiveFiles.shift();
          }
          return;
        }
      }
    }
  }

  _checkCredentialRead(sig, toolName, params) {
    if (sig.sensitiveDataAccessed) {
      // If any sensitive file was a key/credential, flag it
      for (const f of sig.sensitiveFiles) {
        if (/id_rsa|id_ed25519|id_ecdsa|\.pem$|\.key$|credentials|secret/i.test(f)) {
          sig.credentialRead = true;
          return;
        }
      }
    }
    if (toolName === 'exec' || toolName === 'Bash') {
      const cmd = params?.command || '';
      for (const re of CREDENTIAL_COMMANDS) {
        if (re.test(cmd)) {
          sig.credentialRead = true;
          return;
        }
      }
    }
  }

  _checkNetworkUsage(sig, toolName, params) {
    if (toolName === 'web_fetch' || toolName === 'WebFetch') {
      sig.networkUsed = true;
      return;
    }
    if (toolName === 'exec' || toolName === 'Bash') {
      const cmd = params?.command || '';
      for (const re of EXFILTRATION_COMMANDS) {
        if (re.test(cmd)) {
          sig.networkUsed = true;
          return;
        }
      }
    }
  }

  _checkDestructive(sig, toolName, params) {
    if (toolName === 'exec' || toolName === 'Bash') {
      const cmd = params?.command || '';
      if (/\brm\s+-[a-zA-Z]*r/.test(cmd) ||
          /\bgit\s+push\s+.*--force/.test(cmd) ||
          /\bgit\s+reset\s+--hard/.test(cmd) ||
          /\bdropdb\b/.test(cmd) ||
          /DROP\s+(TABLE|DATABASE)/i.test(cmd)) {
        sig.destructiveActionTaken = true;
      }
    }
  }

  _checkEscalation(sig, toolName, params) {
    if (toolName === 'exec' || toolName === 'Bash') {
      const cmd = params?.command || '';
      if (/\bsudo\b/.test(cmd) ||
          /\bchmod\s+[+]s/.test(cmd) ||
          /\bchown\s+root\b/.test(cmd)) {
        sig.escalationAttempted = true;
      }
    }
  }

  _evictOldest() {
    if (this.sessions.size <= this.maxSessions) return;
    // Remove oldest by lastToolTime
    let oldestKey = null, oldestTime = Infinity;
    for (const [key, sig] of this.sessions) {
      if (sig.lastToolTime < oldestTime) {
        oldestTime = sig.lastToolTime;
        oldestKey = key;
      }
    }
    if (oldestKey) this.sessions.delete(oldestKey);
  }

  /**
   * Clear signals for a session (e.g., session ended).
   */
  clear(sessionKey) {
    this.sessions.delete(sessionKey);
  }

  /**
   * Cleanup old sessions (default: older than 2 hours).
   */
  cleanup(olderThanMs = 7200000) {
    const cutoff = Date.now() - olderThanMs;
    for (const [key, sig] of this.sessions) {
      if (sig.lastToolTime > 0 && sig.lastToolTime < cutoff) {
        this.sessions.delete(key);
      }
    }
  }
}

export const sessionSignals = new SessionSignalTracker();
