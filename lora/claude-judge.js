#!/usr/bin/env node

/**
 * Claude Judge — re-judge all unreviewed records in judge.db using Claude.
 * Compares Claude's verdict with the local model's verdict to find disagreements.
 *
 * Usage:
 *   node lora/claude-judge.js                # process all pending
 *   node lora/claude-judge.js --limit 50     # process up to 50
 *   node lora/claude-judge.js --stats        # show stats only
 *   node lora/claude-judge.js --diff         # show disagreements
 */

import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(__dirname);

const dbPath = path.join(__dirname, 'judge.db');
if (!fs.existsSync(dbPath)) {
  console.error('judge.db not found at', dbPath);
  process.exit(1);
}

const db = new Database(dbPath);

// Migrate: add claude columns if missing
const cols = db.prepare("PRAGMA table_info(judge_calls)").all().map(c => c.name);
if (!cols.includes('claude_response')) {
  db.exec(`ALTER TABLE judge_calls ADD COLUMN claude_response TEXT`);
  db.exec(`ALTER TABLE judge_calls ADD COLUMN claude_verdict TEXT`);
  db.exec(`ALTER TABLE judge_calls ADD COLUMN claude_reasoning TEXT`);
  db.exec(`ALTER TABLE judge_calls ADD COLUMN claude_timestamp INTEGER`);
  console.log('Added claude columns to judge_calls');
}

// Load shared system prompt
const systemPrompts = JSON.parse(fs.readFileSync(path.join(projectDir, 'server', 'system-prompts.json'), 'utf8'));
const SYSTEM_PROMPT = systemPrompts['qwen3-4b'].replace(/^\/no_think\n/, ''); // Claude doesn't need /no_think

// Parse args
const args = process.argv.slice(2);
const statsOnly = args.includes('--stats');
const diffOnly = args.includes('--diff');
const riskyOnly = args.includes('--risky');
const warnOnly = args.includes('--warn');
const suspectSafe = args.includes('--suspect-safe');
const allSuspect = args.includes('--all-suspect');
const remainingSafe = args.includes('--remaining-safe');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 50 : 0;

function showStats() {
  const total = db.prepare('SELECT COUNT(*) as cnt FROM judge_calls').get().cnt;
  const reviewed = db.prepare('SELECT COUNT(*) as cnt FROM judge_calls WHERE claude_verdict IS NOT NULL').get().cnt;
  const pending = total - reviewed;

  const agree = db.prepare(`
    SELECT COUNT(*) as cnt FROM judge_calls
    WHERE claude_verdict IS NOT NULL AND verdict = claude_verdict
  `).get().cnt;
  const disagree = reviewed - agree;

  console.log(`\n━━━ Judge DB Stats ━━━`);
  console.log(`Total records:  ${total}`);
  console.log(`Claude reviewed: ${reviewed}`);
  console.log(`Pending:        ${pending}`);
  if (reviewed > 0) {
    console.log(`Agreement:      ${agree}/${reviewed} (${(agree / reviewed * 100).toFixed(1)}%)`);
    console.log(`Disagreements:  ${disagree}`);
  }

  // Breakdown by verdict
  const byVerdict = db.prepare(`
    SELECT verdict, claude_verdict, COUNT(*) as cnt FROM judge_calls
    WHERE claude_verdict IS NOT NULL
    GROUP BY verdict, claude_verdict
    ORDER BY cnt DESC
  `).all();
  if (byVerdict.length > 0) {
    console.log(`\nConfusion (model → claude):`);
    for (const row of byVerdict) {
      const marker = row.verdict !== row.claude_verdict ? ' ✗' : '';
      console.log(`  ${row.verdict} → ${row.claude_verdict}: ${row.cnt}${marker}`);
    }
  }
  console.log();
}

function showDiff() {
  const rows = db.prepare(`
    SELECT id, tool, verdict, claude_verdict, reasoning, claude_reasoning, user_prompt
    FROM judge_calls
    WHERE claude_verdict IS NOT NULL AND verdict != claude_verdict
    ORDER BY id DESC
  `).all();

  console.log(`\n━━━ Disagreements (${rows.length}) ━━━\n`);
  for (const r of rows) {
    const prompt = (r.user_prompt || '').substring(0, 120).replace(/\n/g, ' ');
    console.log(`#${r.id} [${r.tool}] ${prompt}`);
    console.log(`  Model:  ${r.verdict} — ${r.reasoning}`);
    console.log(`  Claude: ${r.claude_verdict} — ${r.claude_reasoning}`);
    console.log();
  }
}

function callClaude(userPrompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '-p', '--model', 'haiku',
      '--system-prompt', SYSTEM_PROMPT,
    ], { encoding: 'utf8', timeout: 60_000 });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.stdin.write(userPrompt);
    proc.stdin.end();

    proc.on('close', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`claude exit ${code}: ${stderr.slice(0, 200)}`));
    });
    proc.on('error', reject);

    setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 60_000);
  });
}

const CONCURRENCY = 16;
const startTime = Date.now();

async function processOne(record, update, stats, total) {
  try {
    const content = await callClaude(record.user_prompt);

    let claudeVerdict = null;
    let claudeReasoning = null;
    try {
      const parsed = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
      claudeVerdict = parsed.verdict?.toUpperCase();
      claudeReasoning = parsed.reason || parsed.reasoning || null;
    } catch {
      const vm = content.match(/"verdict"\s*:\s*"(SAFE|WARNING|BLOCK)"/i);
      if (vm) claudeVerdict = vm[1].toUpperCase();
      const rm = content.match(/"reason(?:ing)?"\s*:\s*"([^"]+)"/);
      if (rm) claudeReasoning = rm[1];
    }

    const modelBinary = record.verdict === 'BLOCK' ? 'BLOCK' : 'ALLOW';
    const claudeBinary = claudeVerdict === 'BLOCK' ? 'BLOCK' : 'ALLOW';
    const match = modelBinary === claudeBinary;

    if (match) stats.agree++;
    else stats.disagree++;

    update.run(content, claudeVerdict, claudeReasoning, Date.now(), record.id);
    stats.processed++;

    const marker = match ? '✓' : '✗';
    const pct = (stats.processed / total * 100).toFixed(0);
    const bar = '█'.repeat(Math.floor(stats.processed / total * 30)) + '░'.repeat(30 - Math.floor(stats.processed / total * 30));
    const elapsed = (Date.now() - startTime) / 1000;
    const perItem = elapsed / stats.processed;
    const remaining = Math.ceil(perItem * (total - stats.processed));
    const etaMin = Math.floor(remaining / 60);
    const etaSec = remaining % 60;
    const eta = etaMin > 0 ? `${etaMin}m${etaSec}s` : `${etaSec}s`;
    process.stdout.write(`\r  ${bar} ${pct}% [${stats.processed}/${total}] ETA ${eta} ${marker} ${record.verdict}→${claudeVerdict} ✓${stats.agree} ✗${stats.disagree}  `);
  } catch (err) {
    stats.errors++;
    console.error(`  ERROR #${record.id}: ${err.message}`);
    if (err.status === 429) {
      await new Promise(r => setTimeout(r, 30_000));
    }
  }
}

async function processRecords() {
  let query = 'SELECT * FROM judge_calls WHERE claude_verdict IS NULL';
  if (warnOnly) query += ` AND verdict = 'WARNING'`;
  else if (riskyOnly) query += ` AND verdict IN ('WARNING', 'BLOCK')`;
  else if (suspectSafe) query += ` AND verdict = 'SAFE' AND (risk_score >= 3 OR (tool IN ('exec','write') AND (user_prompt LIKE '%password%' OR user_prompt LIKE '%secret%' OR user_prompt LIKE '%api_key%' OR user_prompt LIKE '%credential%' OR user_prompt LIKE '%/etc/%' OR user_prompt LIKE '%sudo%' OR user_prompt LIKE '%rm -rf%' OR user_prompt LIKE '%chmod%' OR user_prompt LIKE '%.env%' OR user_prompt LIKE '%private_key%' OR user_prompt LIKE '%ssh%' OR user_prompt LIKE '%token%')))`;
  else if (allSuspect) query += ` AND (verdict IN ('WARNING', 'BLOCK') OR (verdict = 'SAFE' AND (risk_score >= 3 OR (tool IN ('exec','write') AND (user_prompt LIKE '%password%' OR user_prompt LIKE '%secret%' OR user_prompt LIKE '%api_key%' OR user_prompt LIKE '%credential%' OR user_prompt LIKE '%/etc/%' OR user_prompt LIKE '%sudo%' OR user_prompt LIKE '%rm -rf%' OR user_prompt LIKE '%chmod%' OR user_prompt LIKE '%.env%' OR user_prompt LIKE '%private_key%' OR user_prompt LIKE '%ssh%' OR user_prompt LIKE '%token%')))))`;
  else if (remainingSafe) query += ` AND (verdict IN ('WARNING', 'BLOCK') OR (verdict = 'SAFE' AND tool IN ('exec','write','web_fetch','edit','agent_spawn') AND user_prompt LIKE '%chain_history%' AND user_prompt LIKE '%TASK CONTEXT%'))`;
  query += ' ORDER BY id ASC';
  if (limit > 0) query += ` LIMIT ${limit}`;
  const records = db.prepare(query).all();

  if (records.length === 0) {
    console.log('No pending records to process.');
    showStats();
    return;
  }

  console.log(`Processing ${records.length} records with Claude API (concurrency=${CONCURRENCY})...\n`);

  const update = db.prepare(`
    UPDATE judge_calls
    SET claude_response = ?, claude_verdict = ?, claude_reasoning = ?, claude_timestamp = ?
    WHERE id = ?
  `);

  const stats = { processed: 0, agree: 0, disagree: 0, errors: 0 };

  // Process in batches of CONCURRENCY
  for (let i = 0; i < records.length; i += CONCURRENCY) {
    const batch = records.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(r => processOne(r, update, stats, records.length)));
  }

  console.log();
  console.log(`\n━━━ Done ━━━`);
  console.log(`Processed: ${stats.processed}, Agree: ${stats.agree}, Disagree: ${stats.disagree}, Errors: ${stats.errors}`);
  showStats();
}

// Main
if (statsOnly) {
  showStats();
  db.close();
} else if (diffOnly) {
  showDiff();
  db.close();
} else {
  processRecords().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  }).finally(() => db.close());
}
