// GuardClaw Memory System
// Learns from user approve/deny decisions to adapt over time

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export class MemoryStore {
  constructor(dataDir) {
    this.dataDir = dataDir || path.join(process.cwd(), '.guardclaw');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    const dbPath = path.join(this.dataDir, 'memory.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this._initSchema();
    this._prepareStatements();

    console.log('[Memory] Initialized memory store');
    const stats = this.getStats();
    console.log(`[Memory] ${stats.totalDecisions} decisions, ${stats.totalPatterns} patterns`);
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        toolName TEXT NOT NULL,
        command TEXT,
        commandPattern TEXT,
        riskScore INTEGER,
        decision TEXT NOT NULL,
        sessionKey TEXT,
        context TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_decisions_pattern ON decisions(commandPattern);
      CREATE INDEX IF NOT EXISTS idx_decisions_tool ON decisions(toolName);
      CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON decisions(timestamp);

      CREATE TABLE IF NOT EXISTS patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT UNIQUE NOT NULL,
        toolName TEXT,
        approveCount INTEGER DEFAULT 0,
        denyCount INTEGER DEFAULT 0,
        confidence REAL DEFAULT 0,
        lastSeen INTEGER,
        suggestedAction TEXT DEFAULT 'ask'
      );
      CREATE INDEX IF NOT EXISTS idx_patterns_pattern ON patterns(pattern);
      CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence);
    `);
  }

  _prepareStatements() {
    this._stmtInsertDecision = this.db.prepare(`
      INSERT INTO decisions (timestamp, toolName, command, commandPattern, riskScore, decision, sessionKey, context)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this._stmtGetDecisions = this.db.prepare(`
      SELECT * FROM decisions ORDER BY timestamp DESC LIMIT ?
    `);

    this._stmtGetDecisionsByPattern = this.db.prepare(`
      SELECT * FROM decisions WHERE commandPattern = ? ORDER BY timestamp DESC LIMIT ?
    `);

    this._stmtUpsertPattern = this.db.prepare(`
      INSERT INTO patterns (pattern, toolName, approveCount, denyCount, confidence, lastSeen, suggestedAction)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pattern) DO UPDATE SET
        approveCount = approveCount + excluded.approveCount,
        denyCount = denyCount + excluded.denyCount,
        confidence = excluded.confidence,
        lastSeen = excluded.lastSeen,
        suggestedAction = excluded.suggestedAction
    `);

    this._stmtGetPattern = this.db.prepare(`
      SELECT * FROM patterns WHERE pattern = ?
    `);

    this._stmtGetAllPatterns = this.db.prepare(`
      SELECT * FROM patterns ORDER BY lastSeen DESC LIMIT ?
    `);

    this._stmtGetPatternsByTool = this.db.prepare(`
      SELECT * FROM patterns WHERE toolName = ? ORDER BY confidence DESC
    `);

    this._stmtDecisionStats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN decision = 'approve' THEN 1 ELSE 0 END) as approves,
        SUM(CASE WHEN decision = 'deny' THEN 1 ELSE 0 END) as denies
      FROM decisions
    `);

    this._stmtPatternCount = this.db.prepare(`SELECT COUNT(*) as count FROM patterns`);

    this._stmtAutoApproveCount = this.db.prepare(`SELECT COUNT(*) as count FROM patterns WHERE suggestedAction = 'auto-approve'`);
  }

  // ─── Command Pattern Extraction ───

  // Generalize a command into a pattern.
  // e.g. "git push origin main" -> "git push *"
  //      "rm -rf ~/projects/app/node_modules" -> "rm -rf ~/projects/*/node_modules"
  //      "curl https://api.notion.com/v1/pages" -> "curl https://api.notion.com/*"
  //      "cat ~/.ssh/id_rsa" -> "cat ~/.ssh/*"
  extractPattern(toolName, command) {
    if (!command) return `${toolName}:*`;

    let pattern = command;

    // Normalize home directory paths
    pattern = pattern.replace(/\/Users\/[^/\s]+/g, '~');
    pattern = pattern.replace(/\/home\/[^/\s]+/g, '~');

    // Generalize UUIDs and hashes
    pattern = pattern.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>');
    pattern = pattern.replace(/[0-9a-f]{32,}/gi, '<hash>');

    // Generalize timestamps and dates
    pattern = pattern.replace(/\d{10,13}/g, '<timestamp>');
    pattern = pattern.replace(/\d{4}-\d{2}-\d{2}/g, '<date>');

    if (toolName === 'exec') {
      // ─── Exec: nuanced pattern extraction ───
      // Preserves dangerous commands, domains, sensitive paths, and pipe targets

      // 1. curl/wget: keep protocol + domain, generalize URL path
      //    "curl https://api.notion.com/v1/pages/abc" -> "curl https://api.notion.com/*"
      pattern = pattern.replace(
        /((?:curl|wget)\b.*?)(https?:\/\/)([^\s/]+)(\/\S*)?/g,
        '$1$2$3/*'
      );

      // 2. Generalize file paths, but preserve sensitive segments
      //    Sensitive dirs (.ssh, .env, .config) are kept; contents wildcarded
      //    Sensitive files (authorized_keys, id_rsa, .bashrc, .zshrc) are kept as leaf
      const SENSITIVE_DIRS = new Set(['.ssh', '.env', '.config', '.gnupg', '.aws']);
      const SENSITIVE_FILES = new Set(['authorized_keys', 'id_rsa', '.bashrc', '.zshrc']);

      pattern = pattern.replace(/(~\/[^\s"']+)/g, (match) => {
        const parts = match.split('/');

        // Check for sensitive directory in path
        const sensitiveDirIdx = parts.findIndex((p, i) => i > 0 && SENSITIVE_DIRS.has(p));
        if (sensitiveDirIdx !== -1) {
          // Keep ~, wildcard non-sensitive middle, keep sensitive dir, wildcard after
          const result = [parts[0]]; // ~
          for (let i = 1; i < sensitiveDirIdx; i++) result.push('*');
          result.push(parts[sensitiveDirIdx]);
          if (sensitiveDirIdx < parts.length - 1) result.push('*');
          // Deduplicate consecutive wildcards
          return result.filter((p, i) => !(p === '*' && result[i - 1] === '*')).join('/');
        }

        // Check for sensitive filename at end of path
        const lastPart = parts[parts.length - 1];
        if (SENSITIVE_FILES.has(lastPart)) {
          if (parts.length > 3) {
            return `${parts[0]}/${parts[1]}/*/${lastPart}`;
          }
          return match; // short path, keep as-is
        }

        // Non-sensitive: standard generalization (keep first dir + last component)
        if (parts.length > 3) {
          return `${parts[0]}/${parts[1]}/*/${parts[parts.length - 1]}`;
        }
        return match;
      });

      // 3. cd path generalization
      pattern = pattern.replace(/cd\s+\S+/g, 'cd *');

      // 4. git branch/tag generalization
      pattern = pattern.replace(/(git\s+(?:push|pull|checkout|merge|rebase)\s+\S+\s+)\S+/g, '$1*');

      // 5. git commit message generalization
      pattern = pattern.replace(/(git\s+commit\s+-m\s+)"[^"]*"/g, '$1"*"');
      pattern = pattern.replace(/(git\s+commit\s+-m\s+)'[^']*'/g, "$1'*'");

    } else {
      // ─── Non-exec: general path wildcard ───
      // ~/guardclaw/client/src/App.jsx -> ~/guardclaw/*/App.jsx
      pattern = pattern.replace(/(~\/[^/\s]+\/)[^\s]+(\/[^/\s]+)$/g, '$1*$2');
    }

    // For read/write/edit: generalize to directory + extension
    if (['read', 'write', 'edit'].includes(toolName)) {
      // ~/guardclaw/server/index.js -> ~/guardclaw/[wild]/[wild].js
      const extMatch = pattern.match(/\.(\w+)\s*$/);
      if (extMatch) {
        const ext = extMatch[1];
        pattern = pattern.replace(/\/[^/\s]+\.(\w+)\s*$/, `/*.${ext}`);
      }
    }

    return `${toolName}:${pattern.trim()}`;
  }

  // ─── Record a Decision ───

  recordDecision(toolName, command, riskScore, decision, sessionKey = null, context = null) {
    const commandPattern = this.extractPattern(toolName, command);
    const timestamp = Date.now();

    // Insert decision log
    this._stmtInsertDecision.run(
      timestamp, toolName, command, commandPattern,
      riskScore, decision, sessionKey, context
    );

    // Update pattern
    const existing = this._stmtGetPattern.get(commandPattern);
    const approveInc = decision === 'approve' ? 1 : 0;
    const denyInc = decision === 'deny' ? 1 : 0;

    const newApproves = (existing?.approveCount || 0) + approveInc;
    const newDenies = (existing?.denyCount || 0) + denyInc;
    const total = newApproves + newDenies;

    // Confidence: weighted ratio (deny counts 3x)
    // Range: -1 (always deny) to +1 (always approve)
    const weightedApproves = newApproves;
    const weightedDenies = newDenies * 3;
    const confidence = total > 0
      ? (weightedApproves - weightedDenies) / (weightedApproves + weightedDenies)
      : 0;

    // Suggested action based on confidence and count
    let suggestedAction = 'ask';
    if (total >= 3 && confidence > 0.7) {
      suggestedAction = 'auto-approve';
    } else if (total >= 2 && confidence < -0.3) {
      suggestedAction = 'auto-deny';
    }

    this._stmtUpsertPattern.run(
      commandPattern, toolName,
      approveInc, denyInc,
      confidence, timestamp, suggestedAction
    );

    console.log(`[Memory] Recorded ${decision} for "${commandPattern}" (confidence: ${confidence.toFixed(2)}, suggested: ${suggestedAction})`);

    return { commandPattern, confidence, suggestedAction };
  }

  // ─── Query Memory ───

  /**
   * Look up what we know about a command.
   * Returns pattern info + similar past decisions.
   */
  lookup(toolName, command) {
    const commandPattern = this.extractPattern(toolName, command);
    const pattern = this._stmtGetPattern.get(commandPattern);
    const recentDecisions = this._stmtGetDecisionsByPattern.all(commandPattern, 10);

    return {
      pattern: commandPattern,
      found: !!pattern,
      approveCount: pattern?.approveCount || 0,
      denyCount: pattern?.denyCount || 0,
      confidence: pattern?.confidence || 0,
      suggestedAction: pattern?.suggestedAction || 'ask',
      lastSeen: pattern?.lastSeen || null,
      recentDecisions
    };
  }

  /**
   * Get score adjustment based on memory.
   * Returns a value to ADD to the risk score (negative = lower risk).
   * Never adjusts score below 3 or for score >= 9.
   */
  getScoreAdjustment(toolName, command, originalScore) {
    // Never adjust truly dangerous commands
    if (originalScore >= 9) return 0;

    const memory = this.lookup(toolName, command);
    if (!memory.found) return 0;

    // Need at least 3 decisions to have any influence
    const total = memory.approveCount + memory.denyCount;
    if (total < 3) return 0;

    // Apply confidence decay based on age
    const ageMs = Date.now() - (memory.lastSeen || 0);
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    const decayFactor = Math.max(0, 1 - (ageDays / 30)); // linear decay over 30 days

    if (decayFactor < 0.1) return 0; // too old, no adjustment

    let adjustment = 0;
    if (memory.confidence > 0.5) {
      // User frequently approves: lower score by up to 3
      adjustment = -Math.round(memory.confidence * 3 * decayFactor);
    } else if (memory.confidence < -0.3) {
      // User frequently denies: raise score by up to 2
      adjustment = Math.round(Math.abs(memory.confidence) * 2 * decayFactor);
    }

    // Never adjust below score 3 (keep it at least in safe range)
    if (originalScore + adjustment < 3) {
      adjustment = 3 - originalScore;
    }

    return adjustment;
  }

  // ─── API Helpers ───

  getDecisions(limit = 50) {
    return this._stmtGetDecisions.all(limit);
  }

  getPatterns(limit = 100) {
    return this._stmtGetAllPatterns.all(limit);
  }

  getPatternsByTool(toolName) {
    return this._stmtGetPatternsByTool.all(toolName);
  }

  getStats() {
    const dStats = this._stmtDecisionStats.get();
    const pCount = this._stmtPatternCount.get();
    const autoApproveCount = this._stmtAutoApproveCount.get();
    return {
      totalDecisions: dStats.total,
      approves: dStats.approves,
      denies: dStats.denies,
      approveRate: dStats.total > 0 ? (dStats.approves / dStats.total * 100).toFixed(1) : '0',
      totalPatterns: pCount.count,
      autoApproveCount: autoApproveCount.count
    };
  }

  reset() {
    this.db.exec('DELETE FROM decisions');
    this.db.exec('DELETE FROM patterns');
    console.log('[Memory] All memory cleared');
  }

  shutdown() {
    try { this.db.close(); } catch {}
  }
}
