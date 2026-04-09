/**
 * End-to-end tests for CloudJudge provider configs, auth flows, and API dispatch.
 *
 * Tests that don't require real credentials run unconditionally.
 * Tests that need actual API keys are skipped unless the env var is set.
 *
 * Run:  node --test test/cloud-judge.test.js
 */

import { test } from 'node:test';
import * as assert from 'node:assert';

// ─── Import internals via dynamic import so we can inspect them ──────────────

const { cloudJudge, CloudJudge } = await import('../server/cloud-judge.js');

// ─── 1. Provider config sanity ───────────────────────────────────────────────

test('CloudJudge provider configs', async (t) => {
  const providers = CloudJudge.getProviders();
  const byId = Object.fromEntries(providers.map(p => [p.id, p]));

  await t.test('all expected providers present', () => {
    for (const id of ['claude', 'openai', 'openai-codex', 'minimax', 'kimi', 'gemini', 'openrouter']) {
      assert.ok(byId[id], `missing provider: ${id}`);
    }
  });

  await t.test('OAuth-supported providers have correct flag', () => {
    assert.strictEqual(byId['claude'].oauthSupported, true);
    assert.strictEqual(byId['openai-codex'].oauthSupported, true);
    assert.strictEqual(byId['minimax'].oauthSupported, true);
  });

  await t.test('API-key-only providers have oauthSupported=false', () => {
    assert.strictEqual(byId['openai'].oauthSupported, false);
    assert.strictEqual(byId['kimi'].oauthSupported, false);
    assert.strictEqual(byId['gemini'].oauthSupported, false);
    assert.strictEqual(byId['openrouter'].oauthSupported, false);
  });

  await t.test('default models are set', () => {
    assert.ok(byId['minimax'].defaultModel.startsWith('MiniMax'));
    assert.strictEqual(byId['kimi'].defaultModel, 'kimi-k2.5');
    assert.ok(byId['openai-codex'].defaultModel);
  });
});

// ─── 2. startOAuth rejects non-OAuth providers ───────────────────────────────

test('startOAuth rejects non-OAuth providers', async (t) => {
  for (const id of ['openai', 'kimi', 'gemini', 'openrouter']) {
    await t.test(`${id} throws`, async () => {
      await assert.rejects(
        () => cloudJudge.startOAuth(id),
        /does not support OAuth/
      );
    });
  }

  await t.test('unknown provider throws', async () => {
    await assert.rejects(
      () => cloudJudge.startOAuth('nonexistent'),
      /Unknown provider/
    );
  });
});

// ─── 3. Method presence ──────────────────────────────────────────────────────

test('CloudJudge has all required private methods', (t) => {
  const methods = [
    '_callClaudeApiKey',
    '_callClaudeBearer',
    '_callOpenAICompat',
    '_callOpenAICodex',
    '_ensureOpenAICodexToken',
    '_callAnthropicBearer',
    '_startDeviceCodeOAuth',
  ];
  for (const m of methods) {
    assert.strictEqual(typeof cloudJudge[m], 'function', `missing method: ${m}`);
  }
});

// ─── 4. Live API calls (skipped unless env vars are set) ─────────────────────

const TEST_PROMPT = 'Analyze this action: bash command "ls /tmp"';
const TEST_ACTION  = { tool: 'exec', summary: 'ls /tmp' };

async function liveTest(label, envVar, setupFn, t) {
  const key = process.env[envVar];
  if (!key) {
    // Use skip via a diagnostic message — node:test doesn't have t.skip() in older versions
    console.log(`  [skip] ${label} — set ${envVar} to run`);
    return;
  }
  await t.test(label, async () => {
    setupFn(key);
    const result = await cloudJudge.analyze(TEST_PROMPT, TEST_ACTION);
    assert.ok(result, 'analyze() returned null — check credentials');
    assert.ok(result.riskScore >= 1 && result.riskScore <= 10, `riskScore out of range: ${result.riskScore}`);
    assert.ok(['safe', 'warning', 'high_risk', 'warning', 'destructive'].includes(result.category) || result.verdict, 'missing category/verdict');
    console.log(`    riskScore=${result.riskScore} verdict=${result.verdict ?? result.category}`);
  });
}

test('Live API calls (skipped without env vars)', async (t) => {
  const originalProvider = cloudJudge.provider;
  const originalKey      = cloudJudge.apiKey;

  t.after(() => {
    cloudJudge.provider = originalProvider;
    cloudJudge.apiKey   = originalKey;
  });

  await liveTest('Kimi (Moonshot) API key', 'TEST_KIMI_API_KEY', (key) => {
    cloudJudge.provider = 'kimi';
    cloudJudge.apiKey   = key;
    cloudJudge.model    = 'kimi-k2.5';
  }, t);

  await liveTest('Minimax API key', 'TEST_MINIMAX_API_KEY', (key) => {
    cloudJudge.provider = 'minimax';
    cloudJudge.apiKey   = key;
    cloudJudge.model    = 'MiniMax-M2.7';
  }, t);

  await liveTest('OpenAI API key', 'TEST_OPENAI_API_KEY', (key) => {
    cloudJudge.provider = 'openai';
    cloudJudge.apiKey   = key;
    cloudJudge.model    = 'gpt-4o-mini';
  }, t);

  await liveTest('Claude API key', 'TEST_CLAUDE_API_KEY', (key) => {
    cloudJudge.provider = 'claude';
    cloudJudge.apiKey   = key;
    cloudJudge.model    = 'claude-haiku-4-5-20251001';
  }, t);
});
