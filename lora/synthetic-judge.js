#!/usr/bin/env node

/**
 * Build synthetic judge data from events.db using Claude.
 *
 * Extracts unique tool calls from events.db, builds the same prompts
 * safeguard.js would build, sends them to Claude for high-quality verdicts,
 * and stores results in synthetic-judge.db.
 *
 * Usage:
 *   node lora/synthetic-judge.js                  # extract + judge all pending
 *   node lora/synthetic-judge.js --limit 100      # process up to 100
 *   node lora/synthetic-judge.js --extract-only    # extract prompts, don't judge yet
 *   node lora/synthetic-judge.js --judge-only      # judge already-extracted, un-judged records
 *   node lora/synthetic-judge.js --stats           # show stats
 *   node lora/synthetic-judge.js --diff            # compare with original safeguard verdict
 */

import { execFileSync } from 'child_process';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(__dirname);

// Load shared system prompt
const systemPrompts = JSON.parse(fs.readFileSync(path.join(projectDir, 'server', 'system-prompts.json'), 'utf8'));
const SYSTEM_PROMPT = systemPrompts['qwen3-4b'].replace(/^\/no_think\n/, '');

// Events DB (read-only)
const eventsDbPath = path.join(projectDir, '.guardclaw', 'events.db');
if (!fs.existsSync(eventsDbPath)) {
  console.error('events.db not found at', eventsDbPath);
  process.exit(1);
}

// Synthetic judge DB
const synDbPath = path.join(__dirname, 'synthetic-judge.db');
const synDb = new Database(synDbPath);
synDb.pragma('journal_mode = WAL');
synDb.pragma('synchronous = NORMAL');

synDb.exec(`
  CREATE TABLE IF NOT EXISTS synthetic_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    timestamp INTEGER NOT NULL,
    tool TEXT,
    summary TEXT,
    user_prompt TEXT,
    original_verdict TEXT,
    original_reasoning TEXT,
    original_score REAL,
    claude_response TEXT,
    claude_verdict TEXT,
    claude_reasoning TEXT,
    claude_timestamp INTEGER,
    source TEXT,
    session_key TEXT,
    dedup_key TEXT UNIQUE
  )
`);

// Parse args
const args = process.argv.slice(2);
const statsOnly = args.includes('--stats');
const diffOnly = args.includes('--diff');
const extractOnly = args.includes('--extract-only');
const judgeOnly = args.includes('--judge-only');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 100 : 0;

// ─── Tool types we care about ────────────────────────────────────────────────
const USEFUL_TOOLS = new Set([
  'exec', 'read', 'edit', 'write', 'grep', 'glob',
  'web_fetch', 'web_search', 'agent_spawn', 'browser',
  'message', 'canvas', 'process',
]);

// ─── Extract summary from event data ────────────────────────────────────────
function extractSummary(event) {
  let data;
  try { data = JSON.parse(event.data); } catch { return null; }

  if (data.command) return data.command;
  if (data.description) return data.description;

  if (data.rawEvent?.content) {
    for (const block of data.rawEvent.content) {
      if (block.type === 'toolCall' && block.arguments) {
        const a = block.arguments;
        if (a.command) return a.command;
        if (a.file_path) return `file_path: ${a.file_path}`;
        return JSON.stringify(a).substring(0, 200);
      }
    }
  }

  if (typeof data.data === 'string') {
    try {
      const inner = JSON.parse(data.data);
      if (inner.command) return inner.command;
      if (inner.description) return inner.description;
    } catch {}
  }

  return null;
}

// ─── Extract parsed input for detail section ────────────────────────────────
function extractParsedInput(event) {
  let data;
  try { data = JSON.parse(event.data); } catch { return {}; }

  // CC format
  if (typeof data.data === 'string') {
    try {
      const inner = JSON.parse(data.data);
      if (inner.input) return inner.input;
    } catch {}
  }

  // OC format
  if (data.rawEvent?.content) {
    for (const block of data.rawEvent.content) {
      if (block.type === 'toolCall' && block.arguments) return block.arguments;
    }
  }

  return {};
}

// ─── Build user prompt ────────────────────────────────────────────────────────
function buildUserPrompt(tool, summary, parsedInput = {}, chainHistory = [], taskContext = null) {
  let prompt;

  if (tool === 'exec') {
    prompt = `COMMAND: ${summary}`;
  } else {
    let detailSection = '';
    if (tool === 'edit') {
      const fp = parsedInput.file_path || parsedInput.path || '';
      const oldStr = (parsedInput.old_string || '').substring(0, 500);
      const newStr = (parsedInput.new_string || '').substring(0, 500);
      if (fp) detailSection = `\nFILE: ${fp}\nOLD_STRING:\n${oldStr}\nNEW_STRING:\n${newStr}`;
    } else if (tool === 'write') {
      const fp = parsedInput.file_path || parsedInput.path || '';
      const content = (parsedInput.content || '').substring(0, 800);
      if (fp) detailSection = `\nFILE: ${fp}\nCONTENT:\n${content}`;
    } else if (tool === 'read') {
      const fp = parsedInput.file_path || parsedInput.path || '';
      if (fp) detailSection = `\nFILE: ${fp}`;
    }
    prompt = `TOOL: ${tool}\nPARAMS: ${summary}${detailSection}`;
  }

  if (taskContext) {
    prompt += `\n\nTASK CONTEXT (what the user asked the agent to do):\n${taskContext}`;
  }

  if (chainHistory.length > 0) {
    const lines = chainHistory.map((h, i) =>
      `  [${i + 1}] ${h.tool}: ${h.summary.substring(0, 120)}`
    );
    prompt += `\n\nCHAIN HISTORY (prior tool calls in this session):\n${lines.join('\n')}`;
  }

  return prompt;
}

// ─── Dedup key ───────────────────────────────────────────────────────────────
function dedupKey(tool, summary) {
  let key = `${tool}:${(summary || '').substring(0, 150)}`;
  key = key.replace(/\d{10,}/g, 'TS');
  key = key.replace(/[0-9a-f]{8,}/gi, 'HASH');
  key = key.replace(/pid\s*\d+/gi, 'PID');
  return key;
}

// ─── Extract from events.db ──────────────────────────────────────────────────
function extractFromEvents() {
  const eventsDb = new Database(eventsDbPath, { readonly: true });

  console.log('Loading events from events.db...');
  const events = eventsDb.prepare(`
    SELECT id, timestamp, tool, sessionKey, riskScore, category, data
    FROM events
    WHERE tool IS NOT NULL AND tool != ''
      AND riskScore IS NOT NULL
    ORDER BY sessionKey, timestamp
  `).all();
  console.log(`Total scored events: ${events.length}`);

  // Group by session for chain context
  const sessions = new Map();
  for (const evt of events) {
    if (!sessions.has(evt.sessionKey)) sessions.set(evt.sessionKey, []);
    sessions.get(evt.sessionKey).push(evt);
  }

  const insert = synDb.prepare(`
    INSERT OR IGNORE INTO synthetic_calls
      (event_id, timestamp, tool, summary, user_prompt, original_verdict, original_reasoning, original_score, source, session_key, dedup_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let extracted = 0;
  let skipped = 0;

  const insertMany = synDb.transaction((records) => {
    for (const r of records) insert.run(...r);
  });

  const batch = [];

  for (const [sessionKey, sessionEvents] of sessions) {
    for (let idx = 0; idx < sessionEvents.length; idx++) {
      const evt = sessionEvents[idx];
      if (!USEFUL_TOOLS.has(evt.tool)) continue;

      const summary = extractSummary(evt);
      if (!summary || summary.length < 3 || summary.length > 2000) continue;

      const dk = dedupKey(evt.tool, summary);
      const parsedInput = extractParsedInput(evt);

      // Chain history (last 5 in session)
      const chainStart = Math.max(0, idx - 5);
      const chainHistory = [];
      for (let j = chainStart; j < idx; j++) {
        const prev = sessionEvents[j];
        if (!USEFUL_TOOLS.has(prev.tool)) continue;
        const prevSummary = extractSummary(prev);
        if (prevSummary) chainHistory.push({ tool: prev.tool, summary: prevSummary.substring(0, 150) });
      }

      // Task context
      let taskContext = null;
      try {
        const data = JSON.parse(evt.data);
        if (data.safeguard?.taskContext) taskContext = data.safeguard.taskContext;
        if (data.taskContext?.userPrompt) taskContext = data.taskContext.userPrompt;
        if (!taskContext && typeof data.data === 'string') {
          const inner = JSON.parse(data.data);
          if (inner.userPrompt) taskContext = inner.userPrompt;
        }
      } catch {}

      const userPrompt = buildUserPrompt(evt.tool, summary, parsedInput, chainHistory, taskContext);

      // Original verdict
      let originalVerdict = evt.riskScore <= 3 ? 'SAFE' : evt.riskScore <= 7 ? 'WARNING' : 'BLOCK';
      let originalReasoning = '';
      try {
        const data = JSON.parse(evt.data);
        originalReasoning = data.safeguard?.reasoning || '';
      } catch {}

      // Source
      let source = 'unknown';
      if (sessionKey.startsWith('claude-code:')) source = 'cc';
      else if (sessionKey.startsWith('oc:') || sessionKey.startsWith('openclaw:')) source = 'oc';
      else if (sessionKey.startsWith('gemini:')) source = 'gemini';
      else if (sessionKey.startsWith('cursor:')) source = 'cursor';

      batch.push([
        evt.id, evt.timestamp, evt.tool, summary.substring(0, 500), userPrompt,
        originalVerdict, originalReasoning.substring(0, 500), evt.riskScore,
        source, sessionKey, dk,
      ]);
      extracted++;

      if (batch.length >= 1000) {
        insertMany(batch);
        batch.length = 0;
        process.stdout.write(`  Extracted ${extracted}...\r`);
      }
    }
  }

  if (batch.length > 0) insertMany(batch);
  eventsDb.close();

  const total = synDb.prepare('SELECT COUNT(*) as cnt FROM synthetic_calls').get().cnt;
  console.log(`\nExtracted ${extracted} events → ${total} unique records in synthetic-judge.db`);
}

// ─── Judge with Claude ───────────────────────────────────────────────────────
function callClaude(userPrompt) {
  const result = execFileSync('claude', [
    '-p', '--model', 'sonnet',
    '--system-prompt', SYSTEM_PROMPT,
    userPrompt,
  ], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return result.trim();
}

function judgeWithClaude() {
  let query = 'SELECT * FROM synthetic_calls WHERE claude_verdict IS NULL ORDER BY id ASC';
  if (limit > 0) query += ` LIMIT ${limit}`;
  const records = synDb.prepare(query).all();

  if (records.length === 0) {
    console.log('No pending records to judge.');
    return;
  }

  console.log(`Judging ${records.length} records with Claude...\n`);

  const update = synDb.prepare(`
    UPDATE synthetic_calls
    SET claude_response = ?, claude_verdict = ?, claude_reasoning = ?, claude_timestamp = ?
    WHERE id = ?
  `);

  let processed = 0, agree = 0, disagree = 0, errors = 0;

  for (const record of records) {
    try {
      const content = callClaude(record.user_prompt);

      let claudeVerdict = null, claudeReasoning = null;
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

      const match = record.original_verdict === claudeVerdict;
      if (match) agree++; else disagree++;

      update.run(content, claudeVerdict, claudeReasoning, Date.now(), record.id);
      processed++;

      const marker = match ? '✓' : '✗';
      const prompt = (record.summary || '').substring(0, 80);
      console.log(`  [${processed}/${records.length}] ${marker} #${record.id} orig=${record.original_verdict} claude=${claudeVerdict}  ${prompt}`);

    } catch (err) {
      errors++;
      console.error(`  [${processed + 1}/${records.length}] ERROR #${record.id}: ${err.message}`);
      if (err.message.includes('rate') || err.message.includes('429')) {
        console.log('  Rate limited, waiting 30s...');
        const end = Date.now() + 30_000; while (Date.now() < end) {}
      }
    }
  }

  console.log(`\nProcessed: ${processed}, Agree: ${agree}, Disagree: ${disagree}, Errors: ${errors}`);
}

// ─── Stats ───────────────────────────────────────────────────────────────────
function showStats() {
  const total = synDb.prepare('SELECT COUNT(*) as cnt FROM synthetic_calls').get().cnt;
  const judged = synDb.prepare('SELECT COUNT(*) as cnt FROM synthetic_calls WHERE claude_verdict IS NOT NULL').get().cnt;
  const pending = total - judged;

  console.log(`\n━━━ Synthetic Judge DB Stats ━━━`);
  console.log(`Total records:   ${total}`);
  console.log(`Claude judged:   ${judged}`);
  console.log(`Pending:         ${pending}`);

  if (judged > 0) {
    const agree = synDb.prepare(`
      SELECT COUNT(*) as cnt FROM synthetic_calls
      WHERE claude_verdict IS NOT NULL AND original_verdict = claude_verdict
    `).get().cnt;
    console.log(`Agreement:       ${agree}/${judged} (${(agree / judged * 100).toFixed(1)}%)`);
    console.log(`Disagreements:   ${judged - agree}`);

    const byVerdict = synDb.prepare(`
      SELECT original_verdict, claude_verdict, COUNT(*) as cnt FROM synthetic_calls
      WHERE claude_verdict IS NOT NULL
      GROUP BY original_verdict, claude_verdict
      ORDER BY cnt DESC
    `).all();
    console.log(`\nConfusion (original → claude):`);
    for (const row of byVerdict) {
      const marker = row.original_verdict !== row.claude_verdict ? ' ✗' : '';
      console.log(`  ${row.original_verdict} → ${row.claude_verdict}: ${row.cnt}${marker}`);
    }
  }

  // By tool
  const byTool = synDb.prepare('SELECT tool, COUNT(*) as cnt FROM synthetic_calls GROUP BY tool ORDER BY cnt DESC').all();
  console.log(`\nBy tool:`);
  for (const row of byTool) console.log(`  ${row.tool}: ${row.cnt}`);

  // By source
  const bySource = synDb.prepare('SELECT source, COUNT(*) as cnt FROM synthetic_calls GROUP BY source ORDER BY cnt DESC').all();
  console.log(`\nBy source:`);
  for (const row of bySource) console.log(`  ${row.source}: ${row.cnt}`);

  console.log();
}

// ─── Diff ────────────────────────────────────────────────────────────────────
function showDiff() {
  const rows = synDb.prepare(`
    SELECT id, tool, original_verdict, claude_verdict, original_reasoning, claude_reasoning, summary
    FROM synthetic_calls
    WHERE claude_verdict IS NOT NULL AND original_verdict != claude_verdict
    ORDER BY id DESC
  `).all();

  console.log(`\n━━━ Disagreements (${rows.length}) ━━━\n`);
  for (const r of rows) {
    console.log(`#${r.id} [${r.tool}] ${(r.summary || '').substring(0, 120)}`);
    console.log(`  Original: ${r.original_verdict} — ${r.original_reasoning || '(no reason)'}`);
    console.log(`  Claude:   ${r.claude_verdict} — ${r.claude_reasoning}`);
    console.log();
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
if (statsOnly) {
  showStats();
} else if (diffOnly) {
  showDiff();
} else if (judgeOnly) {
  judgeWithClaude();
  showStats();
} else if (extractOnly) {
  extractFromEvents();
  showStats();
} else {
  extractFromEvents();
  judgeWithClaude();
  showStats();
}

synDb.close();
