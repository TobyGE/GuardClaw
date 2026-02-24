import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export class EventStore {
  constructor(maxEvents = 10000) {
    this.maxEvents = maxEvents;
    this.listeners = [];
    this.dataDir = path.join(process.cwd(), '.guardclaw');

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
    `);
  }

  _prepareStatements() {
    this._stmtInsert = this.db.prepare(`
      INSERT OR REPLACE INTO events (id, timestamp, type, tool, subType, sessionKey, riskScore, category, allowed, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this._stmtGetRecent = this.db.prepare(`
      SELECT data FROM events ORDER BY timestamp DESC LIMIT ?
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

    const safeguard = event.safeguard || {};
    this._stmtInsert.run(
      id,
      event.timestamp || Date.now(),
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
    return rows.map(r => JSON.parse(r.data)).reverse();
  }

  getFilteredEvents(limit = 9999, filter = null, session = null) {
    let sql = 'SELECT data FROM events WHERE 1=1';
    const params = [];

    if (session) {
      sql += ' AND sessionKey = ?';
      params.push(session);
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
    return rows.map(r => JSON.parse(r.data)).reverse();
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

  _pruneOldEvents() {
    this._stmtPrune.run(this.maxEvents);
  }

  shutdown() {
    try { this.db.close(); } catch {}
  }

  // Legacy compat — no-ops
  loadEvents() {}
  saveEvents() {}
}
