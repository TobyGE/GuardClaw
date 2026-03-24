import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getGuardClawDir } from './data-dir.js';
import { calcEventTokens } from './token-calculator.js';

export class EventStore {
  constructor(maxEvents = Infinity) {
    this.maxEvents = maxEvents;
    this.listeners = [];
    this.dataDir = getGuardClawDir();

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    const dbPath = path.join(this.dataDir, 'events.db');
    this.db = new Database(dbPath);

    // WAL mode for better concurrent read/write
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this._initSchema();
    this._prepareStatements();
    this._migrateFromJSON();
    this._pruneOldEvents();
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        type TEXT,
        tool TEXT,
        subType TEXT,
        sessionKey TEXT,
        riskScore REAL,
        category TEXT,
        allowed INTEGER,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(sessionKey);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_risk ON events(riskScore);

      CREATE TABLE IF NOT EXISTS counters (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS agent_tokens (
        backend TEXT NOT NULL,
        day TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read INTEGER NOT NULL DEFAULT 0,
        cache_write INTEGER NOT NULL DEFAULT 0,
        requests INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (backend, day)
      );
    `);
  }

  _prepareStatements() {
    this._stmtInsert = this.db.prepare(`
      INSERT OR REPLACE INTO events (id, timestamp, type, tool, subType, sessionKey, riskScore, category, allowed, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this._stmtGetRecent = this.db.prepare(`
      SELECT data, timestamp FROM events ORDER BY timestamp DESC LIMIT ?
    `);

    this._stmtGetById = this.db.prepare(`
      SELECT data FROM events WHERE id = ?
    `);

    this._stmtUpdate = this.db.prepare(`
      UPDATE events SET data = ?, riskScore = ?, category = ?, allowed = ? WHERE id = ?
    `);

    this._stmtCount = this.db.prepare(`SELECT COUNT(*) as count FROM events`);

    // Filtered queries built dynamically in getFilteredEvents()

    this._stmtPrune = this.db.prepare(`
      DELETE FROM events WHERE id NOT IN (
        SELECT id FROM events ORDER BY timestamp DESC LIMIT ?
      )
    `);

    this._stmtStats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN riskScore IS NOT NULL THEN 1 ELSE 0 END) as withSafeguard,
        SUM(CASE WHEN riskScore >= 7 THEN 1 ELSE 0 END) as highRisk,
        SUM(CASE WHEN allowed = 0 THEN 1 ELSE 0 END) as blocked
      FROM events
    `);

    this._stmtCounts = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN riskScore IS NOT NULL AND riskScore < 4 THEN 1 ELSE 0 END) as safe,
        SUM(CASE WHEN riskScore >= 4 AND riskScore < 8 THEN 1 ELSE 0 END) as warn,
        SUM(CASE WHEN allowed = 0 THEN 1 ELSE 0 END) as blocked
      FROM events
    `);
  }

  _migrateFromJSON() {
    const jsonFile = path.join(this.dataDir, 'events.json');
    if (!fs.existsSync(jsonFile)) return;

    // Only migrate if DB is empty
    const count = this._stmtCount.get().count;
    if (count > 0) {
      // DB already has data; rename JSON as backup
      try { fs.renameSync(jsonFile, jsonFile + '.bak'); } catch {}
      return;
    }

    try {
      const raw = fs.readFileSync(jsonFile, 'utf8');
      const parsed = JSON.parse(raw);
      const events = parsed.events || [];
      if (events.length === 0) return;

      console.log(`[EventStore] Migrating ${events.length} events from JSON to SQLite...`);
      const insertMany = this.db.transaction((evts) => {
        for (const evt of evts) {
          this._insertEvent(evt);
        }
      });
      insertMany(events);
      console.log(`[EventStore] Migration complete. ${events.length} events imported.`);

      // Rename old file
      fs.renameSync(jsonFile, jsonFile + '.migrated');
    } catch (err) {
      console.error('[EventStore] JSON migration failed:', err.message);
    }
  }

  _insertEvent(event) {
    const id = event.id || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (!event.id) event.id = id;
    if (!event.timestamp) event.timestamp = Date.now();

    const safeguard = event.safeguard || {};
    this._stmtInsert.run(
      id,
      event.timestamp,
      event.type || null,
      event.tool || event.subType || null,
      event.subType || null,
      event.sessionKey || null,
      safeguard.riskScore ?? null,
      safeguard.category || null,
      safeguard.allowed === false ? 0 : safeguard.allowed === true ? 1 : null,
      JSON.stringify(event)
    );
  }

  addEvent(event) {
    this._insertEvent(event);
    this.notifyListeners(event);

    // Periodic pruning (every ~100 events)
    if (Math.random() < 0.01) {
      this._pruneOldEvents();
    }
  }

  getRecentEvents(limit = 100) {
    const rows = this._stmtGetRecent.all(limit);
    // Results are newest-first from query; reverse to oldest-first (API contract)
    return rows.map(r => {
      const event = JSON.parse(r.data);
      if (!event.timestamp && r.timestamp) event.timestamp = r.timestamp;
      return event;
    }).reverse();
  }

  getFilteredEvents(limit = 9999, filter = null, session = null, backend = null, since = null) {
    let sql = 'SELECT data, timestamp FROM events WHERE 1=1';
    const params = [];

    if (since) {
      sql += ' AND timestamp > ?';
      params.push(since);
    }

    if (backend === 'openclaw') {
      sql += " AND sessionKey LIKE 'agent:%'";
    } else if (backend === 'claude-code') {
      sql += " AND sessionKey LIKE 'claude-code:%'";
    } else if (backend === 'gemini-cli') {
      sql += " AND sessionKey LIKE 'gemini:%'";
    } else if (backend === 'cursor') {
      sql += " AND sessionKey LIKE 'cursor:%'";
    } else if (backend === 'opencode') {
      sql += " AND sessionKey LIKE 'opencode:%'";
    } else if (backend === 'copilot') {
      sql += " AND sessionKey LIKE 'copilot:%'";
    } else if (backend === 'cowork') {
      sql += " AND sessionKey LIKE 'cowork:%'";
    }

    if (session) {
      if (session.includes(':subagent:')) {
        // Subagent tab: exact match only
        sql += ' AND sessionKey = ?';
        params.push(session);
      } else {
        // For OC channel sessions (telegram, discord, etc.), also include agent:main:main
        // so tool calls triggered by channel messages are visible in the channel session view
        const isOCChannel = /^agent:main:[^:]+$/.test(session) && !session.endsWith(':main');
        if (isOCChannel) {
          sql += ' AND (sessionKey = ? OR sessionKey = ? OR (sessionKey LIKE ? AND sessionKey NOT LIKE ?))';
          params.push(session, 'agent:main:main', session + ':%', '%:subagent:%');
        } else {
          sql += ' AND (sessionKey = ? OR (sessionKey LIKE ? AND sessionKey NOT LIKE ?))';
          params.push(session, session + ':%', '%:subagent:%');
        }
      }
    }

    if (filter === 'safe') {
      sql += ' AND (riskScore IS NULL OR riskScore <= 3)';
    } else if (filter === 'warning') {
      sql += ' AND riskScore > 3 AND riskScore <= 7';
    } else if (filter === 'blocked') {
      sql += ' AND riskScore > 7';
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => {
      const event = JSON.parse(r.data);
      if (!event.timestamp && r.timestamp) event.timestamp = r.timestamp;
      return event;
    }).reverse();
  }

  getEventCount() {
    return this._stmtCount.get().count;
  }

  getEventById(id) {
    const row = this._stmtGetById.get(id);
    return row ? JSON.parse(row.data) : null;
  }

  updateEvent(id, updates) {
    const row = this._stmtGetById.get(id);
    if (!row) return false;

    const event = JSON.parse(row.data);
    Object.assign(event, updates);
    const safeguard = event.safeguard || {};

    this._stmtUpdate.run(
      JSON.stringify(event),
      safeguard.riskScore ?? null,
      safeguard.category || null,
      safeguard.allowed === false ? 0 : safeguard.allowed === true ? 1 : null,
      id
    );

    this.notifyListeners({ ...event, _update: true });
    return true;
  }

  getEventsByType(type) {
    const stmt = this.db.prepare('SELECT data FROM events WHERE type = ? ORDER BY timestamp DESC');
    return stmt.all(type).map(r => JSON.parse(r.data));
  }

  getEventsWithHighRisk(minScore = 7) {
    const stmt = this.db.prepare('SELECT data FROM events WHERE riskScore >= ? ORDER BY timestamp DESC');
    return stmt.all(minScore).map(r => JSON.parse(r.data));
  }

  addListener(callback) {
    this.listeners.push(callback);
  }

  removeListener(callback) {
    const index = this.listeners.indexOf(callback);
    if (index >= 0) this.listeners.splice(index, 1);
  }

  notifyListeners(event) {
    for (const listener of this.listeners) {
      try { listener(event); } catch (err) {
        console.error('[EventStore] Listener error:', err);
      }
    }
  }

  clear() {
    this.db.exec('DELETE FROM events');
  }

  getStats() {
    const row = this._stmtStats.get();
    return {
      total: row.total,
      withSafeguard: row.withSafeguard,
      highRisk: row.highRisk,
      blocked: row.blocked,
      safetyRate: row.total > 0 ? ((row.total - row.highRisk) / row.total * 100).toFixed(1) : '100.0'
    };
  }

  /** Get safe/warn/blocked counts matching Bar UI definitions */
  getCounts() {
    return this._stmtCounts.get();
  }

  _pruneOldEvents() {
    // No pruning — keep all events indefinitely.
    // Storage is SQLite on disk, so memory is not an issue.
  }

  shutdown() {
    try { this.db.close(); } catch {}
  }

  // --- Persistent counters ---

  incrementCounter(key, amount = 1) {
    this.db.prepare(`
      INSERT INTO counters (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = value + ?
    `).run(key, amount, amount);
  }

  getCounter(key) {
    const row = this.db.prepare(`SELECT value FROM counters WHERE key = ?`).get(key);
    return row ? row.value : 0;
  }

  getTokenUsage() {
    const tracked = {
      prompt: this.getCounter('token_prompt'),
      completion: this.getCounter('token_completion'),
      requests: this.getCounter('token_requests'),
    };

    // Always include historical estimate (events before precise tracking started)
    if (!this._estimatedTokens) {
      this._calculateHistoricalTokens();
    }
    const est = this._estimatedTokens;
    return {
      promptTokens: est.prompt + tracked.prompt,
      completionTokens: est.completion + tracked.completion,
      totalTokens: est.prompt + est.completion + tracked.prompt + tracked.completion,
      requests: est.requests + tracked.requests,
    };
  }

  _calculateHistoricalTokens() {
    // Scan ALL events — every event represents a potential Haiku API call
    try {
      const rows = this.db.prepare(`SELECT data FROM events`).all();

      let prompt = 0, completion = 0, requests = 0;
      for (const row of rows) {
        try {
          const event = JSON.parse(row.data);
          const tokens = calcEventTokens(event);
          if (tokens) {
            prompt += tokens.promptTokens;
            completion += tokens.completionTokens;
            requests++;
          }
        } catch {}
      }

      console.log(`[TokenCalc] Scanned ${rows.length} events → ${requests} counted, ${prompt + completion} tokens`);
      this._estimatedTokens = { prompt, completion, requests };
    } catch (e) {
      console.error('[TokenCalc] Failed:', e.message);
      this._estimatedTokens = { prompt: 0, completion: 0, requests: 0 };
    }
  }

  // --- Agent token tracking ---

  recordAgentTokens(backend, usage) {
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const input = usage.input || 0;
    const output = usage.output || 0;
    const cacheRead = usage.cacheRead || 0;
    const cacheWrite = usage.cacheWrite || 0;
    this.db.prepare(`
      INSERT INTO agent_tokens (backend, day, input_tokens, output_tokens, cache_read, cache_write, requests)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(backend, day) DO UPDATE SET
        input_tokens = input_tokens + ?,
        output_tokens = output_tokens + ?,
        cache_read = cache_read + ?,
        cache_write = cache_write + ?,
        requests = requests + 1
    `).run(backend, day, input, output, cacheRead, cacheWrite, input, output, cacheRead, cacheWrite);
  }

  getAgentTokens(backend) {
    const day = new Date().toISOString().slice(0, 10);
    const today = this.db.prepare(
      `SELECT input_tokens, output_tokens, cache_read, cache_write, requests FROM agent_tokens WHERE backend = ? AND day = ?`
    ).get(backend, day);
    const allRows = this.db.prepare(
      `SELECT SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, SUM(cache_read) as cache_read, SUM(cache_write) as cache_write, SUM(requests) as requests FROM agent_tokens WHERE backend = ?`
    ).get(backend);
    const defaults = { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0, requests: 0 };
    const normalize = (row) => row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v ?? 0])) : defaults;
    return {
      today: normalize(today),
      cumulative: normalize(allRows),
    };
  }

  getAllAgentTokens() {
    return {
      openclaw: this.getAgentTokens('openclaw'),
      'claude-code': this.getAgentTokens('claude-code'),
    };
  }

  // --- Session summaries (SQL aggregation, no full event load) ---

  getSessionSummaries() {
    const rows = this.db.prepare(`
      SELECT
        sessionKey,
        COUNT(*) as eventCount,
        MIN(timestamp) as firstEventTime,
        MAX(timestamp) as lastEventTime
      FROM events
      WHERE sessionKey IS NOT NULL AND sessionKey != ''
      GROUP BY sessionKey
    `).all();
    return rows;
  }

  // Legacy compat — no-ops
  loadEvents() {}
  saveEvents() {}
}
