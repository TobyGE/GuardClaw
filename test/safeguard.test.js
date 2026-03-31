import { test } from 'node:test';
import * as assert from 'node:assert';
import { SafeguardService } from '../server/safeguard.js';

test('SafeguardService quick analysis', async (t) => {
  const service = new SafeguardService(null, 'fallback');

  await t.test('detects safe commands', () => {
    const result = service.quickAnalysisExpanded('ls -la');
    assert.strictEqual(result.riskScore, 2);
    assert.strictEqual(result.category, 'safe');
    assert.strictEqual(result.allowed, true);
  });

  await t.test('detects destructive commands', () => {
    const result = service.quickAnalysisExpanded('rm -rf /');
    assert.strictEqual(result.riskScore, 10);
    assert.strictEqual(result.category, 'destructive');
    assert.strictEqual(result.allowed, false);
  });

  await t.test('fallback analysis logic', () => {
    const result = service.fallbackAnalysis('sudo rm something');
    assert.strictEqual(result.riskScore, 9);
    assert.strictEqual(result.category, 'destructive');
    assert.strictEqual(result.allowed, false);
  });

  await t.test('cache operations', () => {
    service.addToCache('test-cmd', { riskScore: 5, category: 'test' });
    const cached = service.getFromCache('test-cmd');
    assert.notStrictEqual(cached, null);
    assert.strictEqual(cached.riskScore, 5);
    
    const stats = service.getCacheStats();
    assert.strictEqual(stats.cacheSize, 1);
  });
});
