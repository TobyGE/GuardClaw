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

import { execFileSync } from 'child_process';
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
  const result = execFileSync('claude', [
    '-p', '--model', 'haiku',
    '--system-prompt', SYSTEM_PROMPT,
    userPrompt,
  ], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return result.trim();
}

function processRecords() {
  let query = 'SELECT * FROM judge_calls WHERE claude_verdict IS NULL ORDER BY id ASC';
  if (limit > 0) query += ` LIMIT ${limit}`;
  const records = db.prepare(query).all();

  if (records.length === 0) {
    console.log('No pending records to process.');
    showStats();
    return;
  }

  console.log(`Processing ${records.length} records with Claude CLI...\n`);

  const update = db.prepare(`
    UPDATE judge_calls
    SET claude_response = ?, claude_verdict = ?, claude_reasoning = ?, claude_timestamp = ?
    WHERE id = ?
  `);

  let processed = 0;
  let agree = 0;
  let disagree = 0;
  let errors = 0;

  for (const record of records) {
    try {
      const content = callClaude(record.user_prompt);

      // Parse verdict from Claude's response
      let claudeVerdict = null;
      let claudeReasoning = null;
      try {
        const parsed = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
        claudeVerdict = parsed.verdict?.toUpperCase();
        claudeReasoning = parsed.reason || parsed.reasoning || null;
      } catch {
        // Try regex fallback
        const vm = content.match(/"verdict"\s*:\s*"(SAFE|WARNING|BLOCK)"/i);
        if (vm) claudeVerdict = vm[1].toUpperCase();
        const rm = content.match(/"reason(?:ing)?"\s*:\s*"([^"]+)"/);
        if (rm) claudeReasoning = rm[1];
      }

      // Normalize: WARNING and SAFE both count as ALLOW for comparison
      const modelBinary = record.verdict === 'BLOCK' ? 'BLOCK' : 'ALLOW';
      const claudeBinary = claudeVerdict === 'BLOCK' ? 'BLOCK' : 'ALLOW';
      const match = modelBinary === claudeBinary;

      if (match) agree++;
      else disagree++;

      update.run(content, claudeVerdict, claudeReasoning, Date.now(), record.id);
      processed++;

      const marker = match ? '✓' : '✗';
      const prompt = (record.user_prompt || '').substring(0, 80).replace(/\n/g, ' ');
      console.log(`  [${processed}/${records.length}] ${marker} #${record.id} model=${record.verdict} claude=${claudeVerdict}  ${prompt}`);

    } catch (err) {
      errors++;
      console.error(`  [${processed + 1}/${records.length}] ERROR #${record.id}: ${err.message}`);
      if (err.message.includes('rate') || err.message.includes('429')) {
        console.log('  Rate limited, waiting 30s...');
        const wait = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
        wait(30_000);
      }
    }
  }

  console.log(`\n━━━ Done ━━━`);
  console.log(`Processed: ${processed}, Agree: ${agree}, Disagree: ${disagree}, Errors: ${errors}`);
  showStats();
}

// Main
if (statsOnly) {
  showStats();
} else if (diffOnly) {
  showDiff();
} else {
  try {
    processRecords();
  } catch (err) {
    console.error('Fatal:', err);
    process.exit(1);
  }
}

db.close();
