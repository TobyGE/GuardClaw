/**
 * Drop-in replacement for better-sqlite3 using sql.js (pure WASM SQLite).
 * No native compilation required — works on any platform.
 *
 * Usage:
 *   import Database, { initSqlite } from './database.js';
 *   await initSqlite();  // once at startup
 *   const db = new Database('/path/to/file.db');
 */

import initSqlJs from 'sql.js';
import fs from 'fs';

let SQL = null;

/**
 * Initialize the sql.js WASM engine. Must be called once before creating any Database.
 */
export async function initSqlite() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
}

/**
 * Sanitize values for sql.js binding (convert undefined → null).
 */
function sanitize(params) {
  if (Array.isArray(params)) {
    return params.map(v => (v === undefined ? null : v));
  }
  if (typeof params === 'object' && params !== null) {
    const out = {};
    for (const [k, v] of Object.entries(params)) {
      out[k] = v === undefined ? null : v;
    }
    return out;
  }
  return params;
}

/**
 * Convert positional or named params from better-sqlite3 calling convention
 * to sql.js format.
 *
 * better-sqlite3:  stmt.run(val1, val2)        → positional
 *                  stmt.run({ key: val })       → named (@key in SQL)
 * sql.js:          db.run(sql, [val1, val2])    → positional
 *                  db.run(sql, { '@key': val }) → named
 */
function convertParams(args) {
  if (args.length === 0) return undefined;

  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
    // Named params: add @ prefix for sql.js
    const obj = args[0];
    const bound = {};
    for (const [k, v] of Object.entries(obj)) {
      bound[`@${k}`] = v === undefined ? null : v;
    }
    return bound;
  }

  // Positional params
  return sanitize(args);
}

export default class Database {
  constructor(filepath) {
    if (!SQL) {
      throw new Error('sql.js not initialized — call initSqlite() first');
    }

    this._filepath = filepath;
    this._dirty = false;
    this._saveTimer = null;

    if (fs.existsSync(filepath)) {
      const buffer = fs.readFileSync(filepath);
      this._db = new SQL.Database(buffer);
    } else {
      this._db = new SQL.Database();
    }
  }

  /** Debounced persist to disk (100ms). */
  _scheduleSave() {
    this._dirty = true;
    if (!this._saveTimer) {
      this._saveTimer = setTimeout(() => {
        this._saveTimer = null;
        if (this._dirty) this._persist();
      }, 100);
    }
  }

  /** Write the full DB to disk atomically (temp file + rename). */
  _persist() {
    try {
      const data = this._db.export();
      const buffer = Buffer.from(data);
      const tmp = this._filepath + '.tmp';
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, this._filepath);
      this._dirty = false;
    } catch (err) {
      console.error('[Database] Persist failed:', err.message);
    }
  }

  /** No-op — WAL/synchronous pragmas don't apply to sql.js. */
  pragma(_str) {}

  /** Execute one or more SQL statements (no params). */
  exec(sql) {
    this._db.exec(sql);
    this._scheduleSave();
  }

  /** Return a reusable PreparedStatement handle (mirrors better-sqlite3 API). */
  prepare(sql) {
    return new PreparedStatement(this, sql);
  }

  /** Wrap a function in BEGIN/COMMIT (rollback on error). */
  transaction(fn) {
    return (...args) => {
      this._db.run('BEGIN TRANSACTION');
      try {
        const result = fn(...args);
        this._db.run('COMMIT');
        this._scheduleSave();
        return result;
      } catch (e) {
        this._db.run('ROLLBACK');
        throw e;
      }
    };
  }

  /** Flush pending writes and close. */
  close() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (this._dirty) this._persist();
    this._db.close();
  }
}

/**
 * Mimics better-sqlite3's Statement with .run(), .get(), .all().
 * Each call creates a fresh sql.js prepared statement internally.
 */
class PreparedStatement {
  constructor(database, sql) {
    this._database = database;
    this._sql = sql;
  }

  /** Execute and return { changes }. */
  run(...args) {
    const params = convertParams(args);
    if (params !== undefined) {
      this._database._db.run(this._sql, params);
    } else {
      this._database._db.run(this._sql);
    }
    this._database._scheduleSave();
    return { changes: this._database._db.getRowsModified() };
  }

  /** Return first matching row as an object, or undefined. */
  get(...args) {
    const params = convertParams(args);
    const stmt = this._database._db.prepare(this._sql);
    try {
      if (params !== undefined) stmt.bind(params);
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  /** Return all matching rows as an array of objects. */
  all(...args) {
    const params = convertParams(args);
    const stmt = this._database._db.prepare(this._sql);
    try {
      if (params !== undefined) stmt.bind(params);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      return results;
    } finally {
      stmt.free();
    }
  }
}
