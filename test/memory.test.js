// Regression tests for the memory reform: memory is a signal, not a decision.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initSqlite } from '../server/database.js';
import { MemoryStore, formatMemoryLine } from '../server/memory.js';

before(async () => { await initSqlite(); });

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'guardclaw-memtest-'));
}

describe('MemoryStore — stats do not auto-flip suggestedAction', () => {
  test('repeated denies never produce auto-deny', () => {
    const dir = tempDir();
    const store = new MemoryStore(dir);
    try {
      let last;
      for (let i = 0; i < 10; i++) {
        last = store.recordDecision('exec', 'git push origin main', 9, 'deny', 'sess-1');
      }
      assert.equal(last.suggestedAction, 'ask', 'auto-deny path is removed');
      const looked = store.lookup('exec', 'git push origin main');
      assert.equal(looked.suggestedAction, 'ask');
      assert.equal(looked.denyCount, 10);
      // Confidence still computed for getScoreAdjustment to use.
      assert.ok(looked.confidence < 0);
    } finally {
      store.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('repeated approves do not auto-flip to auto-approve (stats path is gone)', () => {
    const dir = tempDir();
    const store = new MemoryStore(dir);
    try {
      let last;
      for (let i = 0; i < 10; i++) {
        last = store.recordDecision('exec', 'npm test', 2, 'approve', 'sess-1');
      }
      assert.equal(last.suggestedAction, 'ask',
        'stats-derived auto-approve is removed; only setPatternAction can promote');
    } finally {
      store.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('setPatternAction promotes to auto-approve, recordDecision preserves it', () => {
    const dir = tempDir();
    const store = new MemoryStore(dir);
    try {
      const r = store.recordDecision('exec', 'ls -la', 1, 'approve', 'sess-1');
      store.setPatternAction(r.commandPattern, 'auto-approve');
      // A new decision must not undo the user-asserted trust.
      const r2 = store.recordDecision('exec', 'ls -la', 1, 'approve', 'sess-1');
      assert.equal(r2.suggestedAction, 'auto-approve');
    } finally {
      store.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('setPatternAction normalizes auto-deny away (now a no-op label)', () => {
    const dir = tempDir();
    const store = new MemoryStore(dir);
    try {
      const r = store.recordDecision('exec', 'rm -rf /', 10, 'deny', 'sess-1');
      store.setPatternAction(r.commandPattern, 'auto-deny');
      const looked = store.lookup('exec', 'rm -rf /');
      assert.equal(looked.suggestedAction, 'ask',
        'auto-deny is not a respected label anymore — memory does not block');
    } finally {
      store.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('lookupRelated — filters pure-deny patterns', () => {
  test('pattern with denies but no approves is dropped from LLM context', () => {
    const dir = tempDir();
    const store = new MemoryStore(dir);
    try {
      // Pure-deny pattern (likely inferred-timeout, even if 'deny' label was real-looking).
      for (let i = 0; i < 5; i++) {
        store.recordDecision('exec', 'git push origin main 2>&1', 9, 'deny', 'sess-1');
      }
      // Mixed pattern with at least one approve — should survive.
      store.recordDecision('exec', 'git status', 1, 'approve', 'sess-1');
      store.recordDecision('exec', 'git status', 1, 'deny', 'sess-1');

      const related = store.lookupRelated('exec', 'git push something');
      const patterns = related.map(p => p.pattern);
      assert.ok(!patterns.some(p => p.includes('push')), 'pure-deny push pattern is filtered');
      assert.ok(patterns.some(p => p.includes('status')), 'mixed pattern with approves survives');
    } finally {
      store.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('formatMemoryLine — neutral observational format', () => {
  test('no "user marked safe/risky" verdict in output', () => {
    const line = formatMemoryLine({
      pattern: 'exec:git push origin *',
      approveCount: 0,
      denyCount: 6,
      lastSeen: Date.now() - 2 * 86_400_000,
    });
    assert.ok(!/user marked/i.test(line), 'no directive language');
    assert.ok(!/risky|safe/i.test(line), 'no verdict label');
    assert.match(line, /0 approves/);
    assert.match(line, /6 denies/);
    assert.match(line, /last 2d ago/);
  });

  test('handles missing lastSeen gracefully', () => {
    const line = formatMemoryLine({
      pattern: 'exec:ls',
      approveCount: 3,
      denyCount: 0,
      lastSeen: null,
    });
    assert.match(line, /3 approves, 0 denies$/);
  });
});

describe('getScoreAdjustment — memory cannot cross decision bands', () => {
  test('approvals do not lower warning into safe', () => {
    const dir = tempDir();
    const store = new MemoryStore(dir);
    try {
      for (let i = 0; i < 5; i++) {
        store.recordDecision('exec', 'npm run build', 4, 'approve', 'sess-1');
      }
      assert.equal(store.getScoreAdjustment('exec', 'npm run build', 4), 0);
      assert.equal(store.getScoreAdjustment('exec', 'npm run build', 5), -1);
    } finally {
      store.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('denials do not raise warning into ask/block', () => {
    const dir = tempDir();
    const store = new MemoryStore(dir);
    try {
      for (let i = 0; i < 5; i++) {
        store.recordDecision('exec', 'git push origin main', 7, 'deny', 'sess-1');
      }
      assert.equal(store.getScoreAdjustment('exec', 'git push origin main', 7), 0);
      assert.equal(store.getScoreAdjustment('exec', 'git push origin main', 6), 1);
    } finally {
      store.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('memory never softens ask/block-band actions', () => {
    const dir = tempDir();
    const store = new MemoryStore(dir);
    try {
      for (let i = 0; i < 5; i++) {
        store.recordDecision('exec', 'chmod 777 ~/.ssh/id_rsa', 8, 'approve', 'sess-1');
      }
      assert.equal(store.getScoreAdjustment('exec', 'chmod 777 ~/.ssh/id_rsa', 8), 0);
      assert.equal(store.getScoreAdjustment('exec', 'chmod 777 ~/.ssh/id_rsa', 9), 0);
    } finally {
      store.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
