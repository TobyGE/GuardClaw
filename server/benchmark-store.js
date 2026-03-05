import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export class BenchmarkStore {
  constructor() {
    const dataDir = path.join(process.cwd(), '.guardclaw');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(path.join(dataDir, 'benchmarks.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS benchmark_results (
        model TEXT PRIMARY KEY,
        backend TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        accuracy REAL,
        correct INTEGER,
        total INTEGER,
        avgLatencyMs INTEGER,
        totalTimeMs INTEGER,
        falsePositives INTEGER,
        falseNegatives INTEGER,
        data TEXT NOT NULL
      )
    `);

    this._stmtUpsert = this.db.prepare(`
      INSERT INTO benchmark_results (model, backend, timestamp, accuracy, correct, total, avgLatencyMs, totalTimeMs, falsePositives, falseNegatives, data)
      VALUES (@model, @backend, @timestamp, @accuracy, @correct, @total, @avgLatencyMs, @totalTimeMs, @falsePositives, @falseNegatives, @data)
      ON CONFLICT(model) DO UPDATE SET
        backend=@backend, timestamp=@timestamp, accuracy=@accuracy, correct=@correct,
        total=@total, avgLatencyMs=@avgLatencyMs, totalTimeMs=@totalTimeMs,
        falsePositives=@falsePositives, falseNegatives=@falseNegatives, data=@data
    `);

    this._stmtGet = this.db.prepare('SELECT * FROM benchmark_results WHERE model = ?');
    this._stmtGetAll = this.db.prepare('SELECT * FROM benchmark_results ORDER BY timestamp DESC');
  }

  save(model, result) {
    this._stmtUpsert.run({
      model,
      backend: result.backend || 'unknown',
      timestamp: Date.now(),
      accuracy: result.accuracy,
      correct: result.correct,
      total: result.total,
      avgLatencyMs: result.avgLatencyMs,
      totalTimeMs: result.totalTimeMs || 0,
      falsePositives: result.falsePositives,
      falseNegatives: result.falseNegatives,
      data: JSON.stringify({ results: result.results, summary: result.summary }),
    });
  }

  get(model) {
    const row = this._stmtGet.get(model);
    return row ? this._hydrate(row) : null;
  }

  getAll() {
    return this._stmtGetAll.all().map(row => this._hydrate(row));
  }

  _hydrate(row) {
    const parsed = JSON.parse(row.data);
    return {
      model: row.model,
      backend: row.backend,
      timestamp: row.timestamp,
      accuracy: row.accuracy,
      correct: row.correct,
      total: row.total,
      avgLatencyMs: row.avgLatencyMs,
      totalTimeMs: row.totalTimeMs,
      falsePositives: row.falsePositives,
      falseNegatives: row.falseNegatives,
      results: parsed.results,
      summary: parsed.summary,
    };
  }
}
