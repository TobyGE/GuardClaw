import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * JudgeStore — records every LLM judge call (prompt + response) for training data.
 * Stored in lora/ directory alongside other training artifacts.
 */
class JudgeStore {
  constructor() {
    this.db = null;
    this._insert = null;
  }

  init() {
    const loraDir = path.join(__dirname, '..', 'lora');
    if (!fs.existsSync(loraDir)) {
      fs.mkdirSync(loraDir, { recursive: true });
    }

    const dbPath = path.join(loraDir, 'judge.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS judge_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        backend TEXT,
        model TEXT,
        tool TEXT,
        system_prompt TEXT,
        user_prompt TEXT,
        response TEXT,
        risk_score REAL,
        verdict TEXT,
        reasoning TEXT,
        session_key TEXT,
        source TEXT,
        claude_response TEXT,
        claude_verdict TEXT,
        claude_reasoning TEXT,
        claude_timestamp INTEGER
      )
    `);

    // Migrate: add claude columns if they don't exist yet
    const cols = this.db.prepare("PRAGMA table_info(judge_calls)").all().map(c => c.name);
    if (!cols.includes('claude_response')) {
      this.db.exec(`ALTER TABLE judge_calls ADD COLUMN claude_response TEXT`);
      this.db.exec(`ALTER TABLE judge_calls ADD COLUMN claude_verdict TEXT`);
      this.db.exec(`ALTER TABLE judge_calls ADD COLUMN claude_reasoning TEXT`);
      this.db.exec(`ALTER TABLE judge_calls ADD COLUMN claude_timestamp INTEGER`);
    }

    this._insert = this.db.prepare(`
      INSERT INTO judge_calls (timestamp, backend, model, tool, system_prompt, user_prompt, response, risk_score, verdict, reasoning, session_key, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    console.log(`[JudgeStore] Initialized at ${dbPath}`);
  }

  /**
   * Record a judge LLM call.
   * @param {object} entry
   * @param {string} entry.backend - lmstudio, built-in, ollama, anthropic
   * @param {string} entry.model - model ID
   * @param {string} entry.tool - tool being judged (exec, write, read, etc.)
   * @param {string} entry.systemPrompt - system prompt sent to LLM
   * @param {string} entry.userPrompt - user prompt sent to LLM
   * @param {string} entry.response - raw LLM response text
   * @param {number} entry.riskScore - parsed risk score
   * @param {string} entry.verdict - SAFE/WARNING/BLOCK
   * @param {string} entry.reasoning - parsed reasoning
   * @param {string} [entry.sessionKey] - session key
   * @param {string} [entry.source] - cc, oc, gemini, cursor, opencode
   */
  record(entry) {
    if (!this._insert) return;
    try {
      this._insert.run(
        Date.now(),
        entry.backend || null,
        entry.model || null,
        entry.tool || null,
        entry.systemPrompt || null,
        entry.userPrompt || null,
        entry.response || null,
        entry.riskScore ?? null,
        entry.verdict || null,
        entry.reasoning || null,
        entry.sessionKey || null,
        entry.source || null,
      );
    } catch (err) {
      console.error('[JudgeStore] Failed to record:', err.message);
    }
  }

  /** Get total record count */
  count() {
    if (!this.db) return 0;
    return this.db.prepare('SELECT COUNT(*) as cnt FROM judge_calls').get().cnt;
  }

  /** Get recent records */
  recent(limit = 20) {
    if (!this.db) return [];
    return this.db.prepare('SELECT * FROM judge_calls ORDER BY timestamp DESC LIMIT ?').all(limit);
  }
}

export const judgeStore = new JudgeStore();
