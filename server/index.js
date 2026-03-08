#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';
import childProcess from 'child_process';
import crypto from 'crypto';
import { ClawdbotClient } from './clawdbot-client.js';
import { NanobotClient } from './nanobot-client.js';
import { SafeguardService } from './safeguard.js';
import { EventStore } from './event-store.js';
import { SessionPoller } from './session-poller.js';
import { ApprovalHandler } from './approval-handler.js';
import { logger } from './logger.js';
import { shouldSkipEvent, shouldAnalyzeEvent, extractAction, classifyNonExecEvent, parseEventDetails, isExecCommand, extractCommand } from './helpers.js';
import { configRoutes } from './routes/config.js';
import { benchmarkRoutes } from './routes/benchmark.js';
import modelsRouter, { setBackendSwitcher } from './routes/models.js';
import llmEngine from './llm-engine.js';
import { installTracker } from './install-tracker.js';
import { streamingTracker } from './streaming-tracker.js';
import { MemoryStore } from './memory.js';
import { BenchmarkStore } from './benchmark-store.js';
import { getDataDir, getGuardClawDir } from './data-dir.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

// Blocking config (whitelist/blacklist)
const BLOCKING_CONFIG_PATH = path.join(getDataDir(), 'blocking-config.json');
let blockingConfig = { whitelist: [], blacklist: [] };

function loadBlockingConfig() {
  try {
    if (fs.existsSync(BLOCKING_CONFIG_PATH)) {
      const data = fs.readFileSync(BLOCKING_CONFIG_PATH, 'utf8');
      blockingConfig = JSON.parse(data);
      console.log('[GuardClaw] Loaded blocking config:', blockingConfig.whitelist.length, 'whitelist,', blockingConfig.blacklist.length, 'blacklist');
    }
  } catch (error) {
    console.error('[GuardClaw] Failed to load blocking config:', error.message);
  }
}

function saveBlockingConfig() {
  try {
    fs.writeFileSync(BLOCKING_CONFIG_PATH, JSON.stringify(blockingConfig, null, 2));
    console.log('[GuardClaw] Saved blocking config');
  } catch (error) {
    console.error('[GuardClaw] Failed to save blocking config:', error.message);
  }
}

loadBlockingConfig();

// Backend selection: auto (default) | openclaw | nanobot
const BACKEND = (process.env.BACKEND || 'auto').toLowerCase();

// Middleware
app.use(cors());
app.use(express.json());
// Resolve client/dist relative to this file (works in both dev and bundled mode)
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const clientDistPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDistPath, { maxAge: 0, etag: false }));

// ─── Lightweight in-memory rate limiter (no external dependency) ──────────────
const rateLimitBuckets = new Map(); // key → { count, resetAt }
function rateLimit(windowMs, maxRequests) {
  return (req, res, next) => {
    const key = `${req.path}:${req.ip}`;
    const now = Date.now();
    let bucket = rateLimitBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      rateLimitBuckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > maxRequests) {
      console.log(`[GuardClaw] ⚠️ Rate limit exceeded: ${req.path} from ${req.ip} (${bucket.count}/${maxRequests} in ${windowMs / 1000}s)`);
      return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
    }
    next();
  };
}
// Clean up expired buckets every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (now > bucket.resetAt) rateLimitBuckets.delete(key);
  }
}, 120_000);

// Services
const safeguardService = new SafeguardService(
  process.env.ANTHROPIC_API_KEY,
  process.env.SAFEGUARD_BACKEND || 'lmstudio',
  {
    lmstudioUrl: process.env.LMSTUDIO_URL,
    lmstudioModel: process.env.LMSTUDIO_MODEL,
    ollamaUrl: process.env.OLLAMA_URL,
    ollamaModel: process.env.OLLAMA_MODEL
  }
);

const eventStore = new EventStore();
const memoryStore = new MemoryStore();
const benchmarkStore = new BenchmarkStore();

// ─── Tool History Store (for chain analysis) ─────────────────────────────────
// Tracks recent tool calls per session including outputs, for LLM chain analysis
const toolHistoryStore = new Map(); // sessionKey → Array<ToolHistoryEntry>
const MAX_TOOL_HISTORY = 10;

// ─── Evaluation Cache (dedup plugin vs streaming analysis) ───────────────────
// When the plugin calls /api/evaluate, we cache the result so the streaming
// processor can reuse it instead of making a second LLM call for the same tool.
// Key: `${sessionKey}:${toolName}:${stableParamsJson}`, TTL: 60s
const evaluationCache = new Map(); // key → { result, expiresAt }
const lastCCPromptId = new Map();    // sessionKey → promptEventId (for prompt→reply linking)
const lastCCPromptText = new Map();  // sessionKey → last user prompt text (for LLM context)
const ccTranscriptPaths = new Map(); // session_id → transcript_path (cached from Stop hook)
const ccLastReadLine = new Map();    // session_id → last line number processed for intermediate text
// Active CC sub-agents: session_id → { agent_id, agent_type, startTime }
// When a sub-agent is active, tool calls from that session_id are attributed to it.
const ccActiveSubagents = new Map();
// Track when the last CC hook was received (for connection status)
let ccLastHookTime = 0;
const CC_CONNECTED_TIMEOUT_MS = 600_000; // consider CC disconnected after 10min of no hooks
// Track PreToolUse 'ask' decisions awaiting PostToolUse feedback (approve/deny inference)
// Key: `${sessionKey}:${toolName}:${commandHash}` → { toolName, commandStr, displayInput, riskScore, sessionKey, timestamp }
const ccPendingAsks = new Map();
const PENDING_ASK_TIMEOUT_MS = 15_000; // fallback: infer denial after 15s with no PostToolUse
// Reduce noisy repeated "auto-approved" hook messages for identical actions.
const ccAllowNoticeCache = new Map(); // key -> last emitted timestamp
const CC_ALLOW_NOTICE_TTL_MS = 12_000;

// Infer denials for pending asks in a session.
// Called on each new hook — if a new hook arrives and the pending ask wasn't cleared
// by PostToolUse (approve), it means the user denied it.
// excludeKey: skip this key (used in PostToolUse to avoid inferring denial for the current tool)
function inferPendingDenials(sessionKey, excludeKey = null) {
  for (const [key, ask] of ccPendingAsks) {
    if (ask.sessionKey === sessionKey && key !== excludeKey) {
      ccPendingAsks.delete(key);
      memoryStore.recordDecision(ask.toolName, ask.displayInput, ask.riskScore, 'deny', ask.sessionKey);
      console.log(`[GuardClaw] 🧠 Memory: user DENIED blocked action → ${ask.toolName}: ${ask.commandStr.slice(0, 80)}`);
    }
  }
}

function compactToolInput(toolName, params = {}) {
  const shorten = (s, n = 100) => {
    const str = String(s || '');
    return str.length > n ? `${str.slice(0, n)}...` : str;
  };

  switch (toolName) {
    case 'read':
    case 'write':
      return shorten(params.file_path || params.path || '');
    case 'edit':
      return shorten(params.file_path || params.path || '');
    case 'exec':
      return shorten(params.command || '', 120);
    case 'web_fetch':
      return shorten(params.url || '', 120);
    case 'web_search':
      return shorten(params.query || '', 120);
    case 'grep':
      return `"${shorten(params.pattern || '', 40)}" in ${shorten(params.path || '.', 80)}`;
    case 'glob':
      return `"${shorten(params.pattern || '', 40)}" in ${shorten(params.path || '.', 80)}`;
    case 'agent_spawn':
      return shorten(params.description || params.prompt || '', 120);
    case 'skill':
      return shorten(params.skill || params.command || '', 80);
    case 'tool_search':
      return shorten(params.query || '', 80);
    default:
      return shorten(JSON.stringify(params), 120);
  }
}

function shouldEmitAllowNotice(sessionKey, toolName, params) {
  const key = `${sessionKey}:${toolName}:${JSON.stringify(params || {})}`;
  const now = Date.now();
  const last = ccAllowNoticeCache.get(key) || 0;
  ccAllowNoticeCache.set(key, now);

  // Lightweight cleanup
  if (ccAllowNoticeCache.size > 1000) {
    for (const [k, ts] of ccAllowNoticeCache) {
      if (now - ts > CC_ALLOW_NOTICE_TTL_MS) ccAllowNoticeCache.delete(k);
    }
  }
  return now - last > CC_ALLOW_NOTICE_TTL_MS;
}
const EVAL_CACHE_TTL_MS = 60_000;

function generateId(prefix = 'evt') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Map raw streaming steps to a compact analyzed format for storage/display. */
function buildAnalyzedSteps(steps) {
  return steps
    .map(step => ({
      id: step.id,
      type: step.type,
      timestamp: step.timestamp,
      duration: step.duration,
      content: step.content?.substring(0, 200) || '',
      toolName: step.toolName,
      command: step.command || (typeof formatStepCommand === 'function' ? formatStepCommand(step) : null),
      metadata: step.metadata,
      safeguard: step.safeguard || null,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function evalCacheKey(sessionKey, toolName, params) {
  // Sort keys for stable JSON regardless of insertion order
  const stable = JSON.stringify(params || {}, Object.keys(params || {}).sort());
  return `${sessionKey || '_'}:${toolName}:${stable}`;
}

function setCachedEvaluation(sessionKey, toolName, params, result) {
  const key = evalCacheKey(sessionKey, toolName, params);
  evaluationCache.set(key, { result, expiresAt: Date.now() + EVAL_CACHE_TTL_MS });
}

function getCachedEvaluation(sessionKey, toolName, params) {
  const key = evalCacheKey(sessionKey, toolName, params);
  const entry = evaluationCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { evaluationCache.delete(key); return null; }
  return entry.result;
}
function formatStepCommand(step) {
  const input = step.parsedInput || step.metadata?.input || {};
  const tool = step.toolName;
  if (tool === 'edit') {
    const file = input.file_path || input.path || '';
    const oldStr = (input.old_string || input.oldText || '').substring(0, 100);
    const newStr = (input.new_string || input.newText || '').substring(0, 100);
    if (oldStr || newStr) return `edit ${file}\n--- old: ${oldStr}${oldStr.length >= 100 ? '…' : ''}\n+++ new: ${newStr}${newStr.length >= 100 ? '…' : ''}`;
    return `edit ${file}`;
  }
  if (tool === 'write') {
    const file = input.file_path || input.path || '';
    const content = (input.content || '').substring(0, 150);
    return `write ${file}\n${content}${content.length >= 150 ? '…' : ''}`;
  }
  if (tool === 'read') {
    return `read ${input.file_path || input.path || ''}`;
  }
  return null;
}

function extractResultText(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  // MCP content format: { content: [{ type: 'text', text: '...' }] }
  if (result.content && Array.isArray(result.content)) {
    return result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  }
  return JSON.stringify(result);
}

function addToToolHistory(sessionKey, toolName, params, result) {
  if (!sessionKey) return;
  const history = toolHistoryStore.get(sessionKey) || [];
  const resultText = extractResultText(result);
  const resultSnippet = resultText.length > 400 ? resultText.substring(0, 400) + '…[truncated]' : resultText;
  history.push({ toolName, params, resultSnippet, timestamp: Date.now() });
  if (history.length > MAX_TOOL_HISTORY) history.shift();
  toolHistoryStore.set(sessionKey, history);
}

function getChainHistory(sessionKey, currentTool) {
  if (!sessionKey) return null;
  // Only trigger chain analysis for exit-type tools (data can leave the machine)
  const EXIT_TOOLS = new Set(['message', 'sessions_send', 'sessions_spawn', 'exec']);
  if (!EXIT_TOOLS.has(currentTool)) return null;
  const history = toolHistoryStore.get(sessionKey) || [];
  // Always send the full trace — let the LLM judge, not keyword heuristics
  return history.length > 0 ? history : null;
}

// ─── Multi-backend client setup ──────────────────────────────────────────────

const activeClients = []; // { client, name }

// OpenClaw client (only for openclaw or auto mode)
let openclawClient = null;
if (BACKEND === 'openclaw' || BACKEND === 'auto') {
  openclawClient = new ClawdbotClient(
    process.env.OPENCLAW_URL || process.env.CLAWDBOT_URL || 'ws://127.0.0.1:18789',
    process.env.OPENCLAW_TOKEN || process.env.CLAWDBOT_TOKEN,
    {
      autoReconnect: true,
      reconnectDelay: 5000,
      maxReconnectDelay: 30000,
      onConnect: () => {
        logger.info('OpenClaw connection established');
        if (sessionPoller && sessionPoller.polling) {
          sessionPoller.testPermissions();
        }
      },
      onDisconnect: () => {
        logger.warn('OpenClaw connection lost');
      },
      onReconnecting: (attempt, delay) => {
        if (attempt <= 3 || attempt % 10 === 0) {
          logger.info(`OpenClaw reconnecting... (attempt ${attempt}, delay ${Math.round(delay/1000)}s)`);
        }
      }
    }
  );
  activeClients.push({ client: openclawClient, name: 'openclaw' });
}

// Nanobot client (only for nanobot or auto mode)
let nanobotClient = null;
if (BACKEND === 'nanobot' || BACKEND === 'auto') {
  nanobotClient = new NanobotClient(
    process.env.NANOBOT_URL || 'ws://127.0.0.1:18790',
    {
      autoReconnect: true,
      reconnectDelay: 5000,
      maxReconnectDelay: 30000,
      onConnect: () => {
        logger.info('Nanobot connection established');
      },
      onDisconnect: () => {
        logger.warn('Nanobot connection lost');
      },
      onReconnecting: (attempt, delay) => {
        if (delay === -1) {
          logger.warn(`Nanobot: gave up reconnecting after ${attempt - 1} attempts. Not available.`);
        } else {
          logger.info(`Nanobot reconnecting... (attempt ${attempt}, delay ${Math.round(delay/1000)}s)`);
        }
      }
    }
  );
  activeClients.push({ client: nanobotClient, name: 'nanobot' });
}

// Session poller (only works with OpenClaw)
const sessionPoller = openclawClient
  ? new SessionPoller(openclawClient, safeguardService, eventStore)
  : null;

// Approval handler (only works with OpenClaw)
// Blocking feature (optional)
// Use `let` so the toggle endpoint can update it at runtime without gateway restart
let blockingEnabled = process.env.GUARDCLAW_BLOCKING_ENABLED === 'true';

// Fail-closed: when GuardClaw is offline, block dangerous tools (default: true)
// Can be toggled at runtime via POST /api/config/fail-closed
let failClosedEnabled = process.env.GUARDCLAW_FAIL_CLOSED === 'true'; // default OFF — opt-in via env or dashboard
const approvalHandler = (openclawClient && blockingEnabled)
  ? new ApprovalHandler(openclawClient, safeguardService, eventStore, { blockingConfig, memoryStore })
  : null;

if (openclawClient && !blockingEnabled) {
  console.log('[GuardClaw] 👀 Blocking disabled - monitoring only');
}

// ─── SSE endpoint for real-time events ───────────────────────────────────────

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const listener = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      eventStore.removeListener(listener);
    }
  };

  eventStore.addListener(listener);

  // Send keepalive every 30s to prevent idle connection timeout
  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch { /* connection gone */ }
  }, 30000);

  req.on('close', () => {
    clearInterval(keepalive);
    eventStore.removeListener(listener);
  });
});

// ─── API endpoints ───────────────────────────────────────────────────────────

// Lightweight health check — used by the plugin heartbeat. Responds instantly,
// no LLM calls, no database queries. Includes PID so the plugin can detect
// kill commands targeting this process.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, pid: process.pid, ts: Date.now(), failClosed: failClosedEnabled, blockingEnabled });
});

app.get('/api/status', async (req, res) => {
  const pollerStats = sessionPoller ? sessionPoller.getStats() : { mode: 'disabled', consecutiveErrors: 0, seenCommands: 0, polling: false, hasAdminScope: false };
  const cacheStats = safeguardService.getCacheStats();
  const llmStatus = await safeguardService.testConnection();
  const installStats = installTracker.getStats();
  const approvalStats = approvalHandler ? approvalHandler.getStats() : null;

  // Per-backend connection status
  const backendLabels = { openclaw: 'OC', nanobot: 'NB' };
  const backends = {};
  for (const { client, name } of activeClients) {
    backends[name] = { ...client.getConnectionStats(), label: backendLabels[name] || name };
  }
  // Claude Code uses HTTP hooks — consider it "connected" if we received a hook recently
  const ccConnected = ccLastHookTime > 0 && (Date.now() - ccLastHookTime) < CC_CONNECTED_TIMEOUT_MS;
  backends['claude-code'] = { connected: ccConnected, label: 'CC', type: 'http-hook' };

  // Connected if ANY backend is connected
  const anyConnected = ccConnected || activeClients.some(({ client }) => client.getConnectionStats().connected);

  // LLM config for settings UI
  const llmConfig = {
    backend: safeguardService.backend,
    lmstudioUrl: safeguardService.config.lmstudioUrl,
    lmstudioModel: safeguardService.config.lmstudioModel,
    ollamaUrl: safeguardService.config.ollamaUrl,
    ollamaModel: safeguardService.config.ollamaModel
  };

  res.json({
    // Connection status
    connected: anyConnected,
    connectionStats: openclawClient ? openclawClient.getConnectionStats() : (nanobotClient ? nanobotClient.getConnectionStats() : {}),
    backends,

    // Poller status
    pollerMode: pollerStats.mode,
    pollerHasAdminScope: pollerStats.hasAdminScope,
    pollerActive: pollerStats.polling,

    // Event stats
    eventsCount: eventStore.getEventCount(),
    commandsSeen: pollerStats.seenCommands,

    // Safeguard status
    safeguardEnabled: safeguardService.enabled,
    safeguardBackend: safeguardService.backend,
    safeguardCache: cacheStats,
    llmStatus,
    llmConfig,
    tokenUsage: eventStore.getTokenUsage(),
    agentTokens: eventStore.getAllAgentTokens(),

    // Approval status
    approvals: approvalStats,

    // Blocking status
    blocking: {
      enabled: blockingEnabled,
      active: blockingEnabled,
      mode: approvalHandler ? approvalHandler.mode : (blockingEnabled ? 'plugin' : null)
    },

    // Fail-closed status
    failClosed: failClosedEnabled,

    // Install tracking
    install: installStats,

    // Health
    healthy: anyConnected && pollerStats.consecutiveErrors < 3,
    warnings: getSystemWarnings(backends, pollerStats, llmStatus, approvalStats)
  });
});

function getSystemWarnings(backends, pollerStats, llmStatus, approvalStats) {
  const warnings = [];

  const anyConnected = Object.values(backends).some(b => b.connected);

  if (!anyConnected) {
    const names = Object.keys(backends).join(' or ');
    warnings.push({
      level: 'error',
      message: `Not connected to any backend (${names})`,
      suggestion: 'Check if your agent backend is running'
    });
  }


  // LLM warnings only for non-local backends (Anthropic API etc.)
  // Local backends (lmstudio, ollama, built-in) status is shown in Settings UI
  if (llmStatus && !llmStatus.connected && !['fallback', 'built-in', 'lmstudio', 'ollama'].includes(llmStatus.backend)) {
    warnings.push({
      level: 'error',
      message: `${llmStatus.backend.toUpperCase()} not connected`,
      suggestion: 'Check API credentials'
    });
  }

  if (pollerStats.mode === 'event-only') {
    warnings.push({
      level: 'info',
      message: 'Running in event-only mode (no session history polling)',
      suggestion: 'Grant operator.admin scope to your token for full command history'
    });
  }

  if (pollerStats.consecutiveErrors >= 2) {
    warnings.push({
      level: 'warning',
      message: `Session poller experiencing errors (${pollerStats.consecutiveErrors} consecutive)`,
      suggestion: 'Check token permissions and Gateway logs'
    });
  }

  return warnings;
}

app.post('/api/connect', async (req, res) => {
  try {
    const results = await Promise.allSettled(
      activeClients.map(({ client }) => client.connect())
    );
    const connected = results.some(r => r.status === 'fulfilled');
    if (connected) {
      res.json({ status: 'connected' });
    } else {
      res.status(500).json({ error: 'Failed to connect to any backend' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/disconnect', (req, res) => {
  for (const { client } of activeClients) {
    client.disconnect();
  }
  res.json({ status: 'disconnected' });
});

// ─── Sessions: list unique sessions from stored events ─────────────────────
app.get('/api/sessions', (req, res) => {
  const allEvents = eventStore.getRecentEvents(999999);
  const sessionMap = new Map(); // sessionKey → { key, label, parent, eventCount, lastEventTime, firstEventTime }
  // Sub-agent detection relies on SubagentStart/SubagentStop hooks (sessionKey contains :subagent:)

  for (const event of allEvents) {
    // Normalize legacy session keys to the canonical format
    const key = (!event.sessionKey || event.sessionKey === 'default') ? 'agent:main:main' : event.sessionKey;
    if (!key) continue;

    const isCCSession = key.startsWith('claude-code:');
    const isSubagent = key.includes(':subagent:');

    // For non-sub-agent OC sessions, merge by channel (e.g. all agent:main:cron:* → one "Cron" entry)
    let mapKey = key;
    if (!isCCSession && !isSubagent && key.startsWith('agent:')) {
      const parts = key.split(':');
      mapKey = parts.length > 2 ? `agent:main:${parts[2]}` : key;
    }

    const existing = sessionMap.get(mapKey);
    if (existing) {
      existing.eventCount++;
      existing.lastEventTime = Math.max(existing.lastEventTime, event.timestamp || 0);
      if (!existing.keys.includes(key)) existing.keys.push(key);
    } else {
      // Derive parent key and short ID for sub-agents
      let parentKey = null;
      const shortId = isSubagent ? key.split(':subagent:')[1]?.substring(0, 8) : null;
      if (isSubagent) {
        if (isCCSession) {
          // CC: claude-code:<uuid>:subagent:<id> → claude-code:<uuid>
          parentKey = key.replace(/:subagent:[^:]+$/, '');
        } else {
          // OC: agent:main:subagent:<uuid> → agent:main:main
          parentKey = key.replace(/:subagent:[^:]+$/, ':main');
        }
      }

      let label;
      if (isCCSession && isSubagent) {
        label = `Sub-agent ${shortId}`;
      } else if (isCCSession) {
        label = 'Claude Code';
      } else if (isSubagent) {
        label = `Sub-agent ${shortId}`;
      } else {
        const parts = key.split(':');
        const channel = parts.length > 2 ? parts[2] : 'main';
        const channelLabels = {
          main: 'Main Agent',
          telegram: 'Telegram',
          whatsapp: 'WhatsApp',
          discord: 'Discord',
          signal: 'Signal',
          slack: 'Slack',
          webchat: 'Webchat',
          irc: 'IRC',
        };
        label = channelLabels[channel] || `Agent (${channel})`;
      }

      sessionMap.set(mapKey, {
        key: mapKey,
        keys: [key],
        label,
        parent: parentKey,
        isSubagent,
        eventCount: 1,
        firstEventTime: event.timestamp || 0,
        lastEventTime: event.timestamp || 0,
        active: true,
      });
    }

  }

  // Label CC sessions that have sub-agents (detected via SubagentStart hook) as "Main"
  // Sub-agents are identified by sessionKey pattern: claude-code:<uuid>:subagent:<id>
  for (const s of sessionMap.values()) {
    if (s.key.startsWith('claude-code:') && s.isSubagent && s.parent) {
      const parentSession = sessionMap.get(s.parent);
      if (parentSession && parentSession.label !== 'Main') parentSession.label = 'Main';
    }
  }

  // Mark sessions as inactive/hidden based on idle time
  // Sub-agents (OC + CC): inactive after 2min, hidden after 24h
  // CC sessions: inactive after 10min, hidden after 24h (keep most recent)
  // Non-primary main sessions: inactive after 10min, hidden after 7 days
  const now = Date.now();
  const hiddenKeys = [];
  const mainSessions = Array.from(sessionMap.values()).filter(s => !s.isSubagent && !s.key.startsWith('claude-code:'));
  const primaryMainKey = mainSessions.length > 0
    ? mainSessions.sort((a, b) => b.eventCount - a.eventCount)[0].key
    : null;

  // Find the most recent CC session (by lastEventTime) to keep it visible
  const ccMainSessions = Array.from(sessionMap.values()).filter(s => s.key.startsWith('claude-code:') && !s.isSubagent);
  const primaryCCKey = ccMainSessions.length > 0
    ? ccMainSessions.sort((a, b) => b.lastEventTime - a.lastEventTime)[0].key
    : null;

  for (const s of sessionMap.values()) {
    const idleMs = now - s.lastEventTime;
    if (s.key.startsWith('claude-code:')) {
      if (s.isSubagent) {
        // CC sub-agents: hidden after 1h (they're numerous and unique), inactive after 2min
        if (idleMs > 60 * 60 * 1000) {
          hiddenKeys.push(s.key);
        } else if (idleMs > 2 * 60 * 1000) {
          s.active = false;
        }
      } else if (s.key !== primaryCCKey && idleMs > 24 * 60 * 60 * 1000) {
        hiddenKeys.push(s.key);
      } else if (idleMs > 10 * 60 * 1000) {
        s.active = false;
      }
    } else if (s.isSubagent) {
      if (idleMs > 24 * 60 * 60 * 1000) {
        hiddenKeys.push(s.key);
      } else if (idleMs > 2 * 60 * 1000) {
        s.active = false;
      }
    } else if (s.key !== primaryMainKey) {
      // Secondary main sessions (different channels)
      if (idleMs > 7 * 24 * 60 * 60 * 1000) {
        hiddenKeys.push(s.key);
      } else if (idleMs > 10 * 60 * 1000) {
        s.active = false;
      }
    }
  }
  for (const k of hiddenKeys) sessionMap.delete(k);

  // Sort: main first, then active sub-agents, then inactive by lastEventTime descending
  const sessions = Array.from(sessionMap.values()).sort((a, b) => {
    if (!a.isSubagent && b.isSubagent) return -1;
    if (a.isSubagent && !b.isSubagent) return 1;
    return b.firstEventTime - a.firstEventTime;
  });

  res.json({ sessions });
});

app.get('/api/events/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const filter = req.query.filter || null;   // 'safe', 'warning', 'blocked'
  const sessionFilter = req.query.session || null;
  const backend = req.query.backend || null; // 'openclaw', 'claude-code', 'nanobot'

  // Filtering pushed down to SQLite for performance
  let events = eventStore.getFilteredEvents(limit, filter, sessionFilter, backend);

  res.json({
    events: events.reverse(), // Newest first
    total: events.length,
    filter: filter || 'all'
  });
});

app.get('/api/streaming/sessions', (req, res) => {
  const sessions = streamingTracker.getAllSessions();
  res.json({ 
    sessions: sessions.map(s => ({
      key: s.key,
      startTime: s.startTime,
      stepCount: s.steps.length
    }))
  });
});

app.get('/api/streaming/session/:sessionKey', (req, res) => {
  const { sessionKey } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  const steps = streamingTracker.getSessionSteps(sessionKey, limit);
  
  res.json({
    sessionKey,
    steps: steps.map(step => ({
      id: step.id,
      timestamp: step.timestamp,
      type: step.type,
      duration: step.duration,
      content: step.content?.substring(0, 500),
      toolName: step.toolName,
      command: step.command,
      safeguard: step.safeguard,
      metadata: step.metadata
    })),
    total: steps.length
  });
});

app.post('/api/safeguard/analyze', async (req, res) => {
  const { command } = req.body;
  try {
    const analysis = await safeguardService.analyzeCommand(command);
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Pre-Execution Tool Check API (for OpenClaw plugin) ─────────────────────

/**
 * Check if a tool should be allowed to execute
 * Called by OpenClaw plugin BEFORE tool execution
 */
app.post('/api/check-tool', async (req, res) => {
  const { toolName, params, sessionKey, agentId } = req.body;
  
  if (!toolName) {
    return res.status(400).json({ error: 'toolName is required' });
  }
  
  try {
    // Build action object for analysis
    const action = {
      type: toolName,
      tool: toolName,
      summary: `${toolName}: ${JSON.stringify(params || {}).substring(0, 120)}`,
      parsedInput: params || {},   // full params — write/edit uses this to judge content
      details: {
        tool: toolName,
        params: params || {},
        sessionKey,
        agentId
      }
    };
    
    // Check whitelist/blacklist first (instant)
    const toolKey = `${toolName}:${JSON.stringify(params || {})}`;
    if (blockingConfig.whitelist.includes(toolKey)) {
      console.log(`[GuardClaw] ✅ Tool whitelisted: ${toolName}`);
      return res.json({ 
        allowed: true, 
        riskScore: 0, 
        reason: 'Whitelisted',
        source: 'whitelist'
      });
    }
    
    if (blockingConfig.blacklist.includes(toolKey)) {
      console.log(`[GuardClaw] 🚫 Tool blacklisted: ${toolName}`);
      return res.json({ 
        allowed: false, 
        riskScore: 10, 
        reason: 'Blacklisted by user',
        source: 'blacklist'
      });
    }
    
    // Analyze with safeguard service
    console.log(`[GuardClaw] 🔍 Pre-execution check: ${toolName}`);
    const analysis = await safeguardService.analyzeAction(action);
    
    // Decision logic
    const autoAllowThreshold = parseInt(process.env.GUARDCLAW_AUTO_ALLOW_THRESHOLD || '6', 10);
    const autoBlockThreshold = parseInt(process.env.GUARDCLAW_AUTO_BLOCK_THRESHOLD || '9', 10);
    
    let allowed = true;
    let reason = 'Safe';
    
    if (analysis.riskScore >= autoBlockThreshold) {
      allowed = false;
      reason = analysis.reasoning || 'High risk detected';
    } else if (analysis.riskScore > autoAllowThreshold) {
      // Medium risk: could require manual approval in future
      // For now, allow but log warning
      console.warn(`[GuardClaw] ⚠️ Medium risk tool: ${toolName} (score: ${analysis.riskScore})`);
    }
    
    console.log(`[GuardClaw] ${allowed ? '✅' : '🚫'} Tool check result: ${toolName}, risk=${analysis.riskScore}, allowed=${allowed}`);
    
    res.json({
      allowed,
      riskScore: analysis.riskScore,
      reason,
      category: analysis.category,
      reasoning: analysis.reasoning,
      warnings: analysis.warnings || [],
      backend: analysis.backend
    });
  } catch (error) {
    console.error('[GuardClaw] Tool check failed:', error);
    // On error, fail-open (allow execution)
    res.json({ 
      allowed: true, 
      riskScore: 0, 
      reason: 'Analysis error, allowing by default',
      error: error.message 
    });
  }
});

/**
 * Report tool execution result (for learning/auditing)
 * Called by OpenClaw plugin AFTER tool execution
 */
app.post('/api/tool-executed', async (req, res) => {
  const { toolName, params, error, durationMs, sessionKey, agentId } = req.body;
  
  try {
    // Log execution for auditing
    console.log(`[GuardClaw] 📝 Tool executed: ${toolName}, duration=${durationMs}ms, error=${!!error}`);
    
    // Could store in database for ML training in future
    // For now, just acknowledge
    res.json({ success: true });
  } catch (err) {
    console.error('[GuardClaw] Failed to log execution:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Store tool result for chain analysis + attach to UI event
 * Called by OpenClaw plugin via after_tool_call hook
 */
app.post('/api/tool-result', async (req, res) => {
  const { sessionKey, toolName, params, result, durationMs } = req.body;
  if (!toolName) return res.status(400).json({ error: 'toolName required' });

  // Store in history for chain analysis
  addToToolHistory(sessionKey, toolName, params, result);
  console.log(`[GuardClaw] ⛓️  Tool result stored: ${toolName} (session: ${sessionKey}), history size: ${(toolHistoryStore.get(sessionKey) || []).length}`);

  // Attach result to the most recent matching stored event (for UI display)
  if (sessionKey) {
    const resultText = extractResultText(result);
    const toolResult = resultText.length > 1000 ? resultText.substring(0, 1000) + '…[truncated]' : resultText;
    const cutoff = Date.now() - 3 * 60 * 1000; // within last 3 min
    const recentEvents = eventStore.getRecentEvents(200);
    const matchingEvent = [...recentEvents].reverse().find(e =>
      e.type === 'tool-call' &&
      e.tool === toolName &&
      e.sessionKey === sessionKey &&
      e.timestamp > cutoff &&
      !e.toolResult
    );
    if (matchingEvent) {
      eventStore.updateEvent(matchingEvent.id, { toolResult, durationMs });
      console.log(`[GuardClaw] ✅ Attached result to event ${matchingEvent.id} (${toolName})`);
    }
  }

  res.json({ success: true });
});

// ─── Pre-Execution Risk Evaluation API (uses LM Studio) ──────────────────────

app.post('/api/evaluate', async (req, res) => {
  const { toolName, params, sessionKey } = req.body;
  
  if (!toolName) {
    return res.status(400).json({ error: 'toolName is required' });
  }
  
  try {
    // Get chain history if applicable (exit-type tools with sensitive prior access)
    const chainHistory = getChainHistory(sessionKey, toolName);
    if (chainHistory) {
      console.log(`[GuardClaw] ⛓️  Chain analysis triggered for ${toolName} (${chainHistory.length} history steps, ${chainHistory.filter(h => h.hasSensitiveAccess).length} sensitive)`);
    }

    // Memory: lookup past decisions BEFORE LLM call (enables auto-approve shortcut)
    const commandStr = toolName === 'exec' ? (params.command || '') : JSON.stringify(params);
    const mem = memoryStore.lookup(toolName, commandStr);
    let memoryHint = null;
    if (mem.found && (mem.approveCount + mem.denyCount) > 0) {
      memoryHint = {
        pattern: mem.pattern,
        approveCount: mem.approveCount,
        denyCount: mem.denyCount,
        confidence: mem.confidence,
        suggestedAction: mem.suggestedAction
      };
    }

    // Auto-approve: if memory says auto-approve and blocking is on, skip LLM entirely
    if (blockingEnabled && memoryHint && memoryHint.suggestedAction === 'auto-approve') {
      // Compute what the adjusted score would be (use a moderate base since we skip LLM)
      const baseScore = 5; // neutral base for memory-only evaluation
      const adjustment = memoryStore.getScoreAdjustment(toolName, commandStr, baseScore);
      const adjustedScore = Math.max(1, Math.min(10, baseScore + adjustment));

      // Safety check: never auto-approve if adjusted score >= 9
      if (adjustedScore < 9) {
        console.log(`[GuardClaw] 🧠 Auto-approved by memory: ${memoryHint.pattern} (confidence: ${memoryHint.confidence.toFixed(2)})`);
        const autoResult = {
          action: 'allow',
          risk: adjustedScore,
          originalRisk: baseScore,
          memoryAdjustment: adjustment,
          memory: memoryHint,
          chainRisk: false,
          reason: `Auto-approved by memory: pattern "${memoryHint.pattern}" approved ${memoryHint.approveCount} times (confidence: ${memoryHint.confidence.toFixed(2)})`,
          details: `Memory auto-approve — ${memoryHint.approveCount} approvals, ${memoryHint.denyCount} denials`,
          backend: 'memory',
          autoApproved: true,
          blockingEnabled,
        };
        // Cache the auto-approve result so streaming processor reuses it
        setCachedEvaluation(sessionKey, toolName, params, {
          riskScore: adjustedScore,
          reasoning: autoResult.reason,
          warnings: [],
          backend: 'memory',
          memory: memoryHint,
          memoryAdjustment: adjustment,
          originalRiskScore: baseScore,
        });
        return res.json(autoResult);
      }
    }

    // Build memory context for LLM prompt injection
    const relatedPatterns = memoryStore.lookupRelated(toolName, commandStr);
    const memoryContext = relatedPatterns.length > 0 ? relatedPatterns.map(p => {
      const verdict = p.approveCount > p.denyCount ? 'safe' : 'risky';
      return `- "${p.pattern}" — user marked ${verdict} (${p.approveCount} approves, ${p.denyCount} denies)`;
    }).join('\n') : null;

    let analysis;

    if (toolName === 'skill' || toolName === 'Skill') {
      // Skill: read file content and do LLM-based instruction security review
      const skillName = params?.skill || (params?.command || '').replace(/^skill\s+/, '').split(/\s+/)[0] || 'unknown';
      const skillFile = readSkillFile(skillName, null);
      console.log(`[GuardClaw] 🔍 [evaluate] Reviewing skill "${skillName}"${skillFile ? ` (${skillFile.filePath})` : ' (file not found)'}`);
      analysis = await safeguardService.analyzeSkillContent(skillName, skillFile?.content || null);
    } else if (toolName === 'exec') {
      // For exec, analyze the command with full LLM analysis
      const cmd = params.command || '';
      analysis = await safeguardService.analyzeCommand(cmd, chainHistory, memoryContext);
    } else {
      // For other tools, analyze the action
      analysis = await safeguardService.analyzeToolAction({
        tool: toolName,
        summary: JSON.stringify(params),
        ...params
      }, chainHistory, memoryContext);
    }

    // Memory: apply score adjustment from earlier lookup
    let originalScore = analysis.riskScore;
    if (memoryHint) {
      analysis.memory = memoryHint;

      const adjustment = memoryStore.getScoreAdjustment(toolName, commandStr, originalScore);
      if (adjustment !== 0) {
        analysis.riskScore = Math.max(1, Math.min(10, originalScore + adjustment));
        analysis.memoryAdjustment = adjustment;
        analysis.originalRiskScore = originalScore;
        console.log(`[GuardClaw] 🧠 Memory adjusted score: ${originalScore} -> ${analysis.riskScore} (${adjustment > 0 ? '+' : ''}${adjustment})`);
      }
    }

    // Cache result so streaming processor reuses it instead of calling LLM again
    setCachedEvaluation(sessionKey, toolName, params, analysis);

    // Return evaluation result.
    // In monitor mode (blockingEnabled=false), always return 'allow' so the plugin
    // never intercepts — monitoring and blocking are consistent from the user's POV.
    const shouldBlock = blockingEnabled && analysis.riskScore >= 8;
    // Occasionally sample WARNING verdicts (score 4-7) for user feedback (~15% chance)
    const isWarning = analysis.riskScore >= 4 && analysis.riskScore <= 7;
    const shouldSampleFeedback = blockingEnabled && isWarning && Math.random() < 0.05;
    res.json({
      action: shouldBlock ? 'ask' : (shouldSampleFeedback ? 'ask' : 'allow'),
      feedbackSample: shouldSampleFeedback || undefined,
      risk: analysis.riskScore,
      originalRisk: analysis.originalRiskScore || analysis.riskScore,
      memoryAdjustment: analysis.memoryAdjustment || 0,
      memory: memoryHint,
      chainRisk: analysis.chainRisk || false,
      reason: analysis.reasoning || analysis.category,
      details: analysis.warnings?.join('; ') || analysis.reasoning || '',
      backend: analysis.backend,
      blockingEnabled,
    });
  } catch (error) {
    console.error('[GuardClaw] /api/evaluate failed:', error);
    // On error, default to allow (fail-open for availability)
    res.json({
      action: 'allow',
      risk: 5,
      reason: '分析失败，默认允许',
      details: error.message,
      backend: 'fallback'
    });
  }
});

// ─── Claude Code Hook Integration ────────────────────────────────────────────

// Pending approvals for Claude Code (HTTP hooks hold the connection)
const pendingApprovals = new Map(); // id → { toolName, params, riskScore, reason, resolve, createdAt }
let approvalIdCounter = 0;

// Tool name mapping: Claude Code → GuardClaw
function mapClaudeCodeTool(toolName) {
  const map = {
    Bash: 'exec',
    Edit: 'edit',
    Write: 'write',
    Read: 'read',
    Glob: 'glob',          // separate from read — can search for credential files
    Grep: 'grep',          // separate from read — can search file contents for secrets
    Agent: 'agent_spawn',  // spawns sub-agent with full permissions
    WebFetch: 'web_fetch',
    WebSearch: 'web_search',
    NotebookEdit: 'write', // modifies files, treat like write
    Skill: 'skill',        // executes arbitrary agent skills
    EnterWorktree: 'worktree',
    EnterPlanMode: 'plan_mode',
    ExitPlanMode: 'plan_mode',
    TaskCreate: 'task',
    TaskUpdate: 'task',
    AskUserQuestion: 'ask_user',
  };
  return map[toolName] || toolName.toLowerCase();
}

// Map Claude Code tool_input → GuardClaw params
function mapClaudeCodeParams(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return {};
  switch (toolName) {
    case 'Bash': return { command: toolInput.command || '' };
    case 'Edit': return { file_path: toolInput.file_path, new_string: toolInput.new_string, old_string: toolInput.old_string };
    case 'Write': return { file_path: toolInput.file_path, content: toolInput.content };
    case 'Read': return { file_path: toolInput.file_path };
    case 'Glob': return { command: `glob ${toolInput.pattern || ''}`, pattern: toolInput.pattern, path: toolInput.path };
    case 'Grep': return { command: `grep ${toolInput.pattern || ''} ${toolInput.path || ''}`, pattern: toolInput.pattern, path: toolInput.path };
    case 'Agent': return { command: `agent_spawn [${toolInput.subagent_type || 'general'}] ${(toolInput.prompt || toolInput.description || '').slice(0, 200)}` };
    case 'WebFetch': return { command: `web_fetch ${toolInput.url || ''}`, url: toolInput.url };
    case 'WebSearch': return { command: `web_search ${toolInput.query || ''}`, query: toolInput.query };
    case 'NotebookEdit': return { file_path: toolInput.notebook_path, content: toolInput.new_source };
    case 'Skill': return { command: `skill ${toolInput.skill || ''} ${toolInput.args || ''}` };
    case 'EnterWorktree': return { command: `worktree ${toolInput.name || ''}`, dangerouslyDisableSandbox: toolInput.dangerouslyDisableSandbox };
    case 'ToolSearch': return { command: `tool_search ${toolInput.query || ''}`, query: toolInput.query };
    default: return toolInput;
  }
}

// Emit any new assistant text blocks from the Claude Code transcript as claude-code-text events.
// Called in PreToolUse (captures text before each tool call) and Stop (captures remaining text).
function emitIntermediateText(session_id) {
  const transcriptPath = ccTranscriptPaths.get(session_id);
  if (!transcriptPath) return;
  const baseKey = session_id ? `claude-code:${session_id}` : 'claude-code:default';
  try {
    const content = fs.readFileSync(transcriptPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const lastPos = ccLastReadLine.get(session_id) || 0;
    for (let i = lastPos; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type !== 'assistant') continue;
        const msgContent = entry.message?.content || entry.content;
        if (!Array.isArray(msgContent)) continue;
        // Attribute to sub-agent if the transcript entry has an agentId (sidechain entries),
        // or if a sub-agent is currently active. This ensures text emitted after SubagentStop
        // (e.g., task-notification results) is still attributed to the correct sub-agent.
        let sessionKey = baseKey;
        if (entry.agentId) {
          sessionKey = `${baseKey}:subagent:${entry.agentId}`;
        } else {
          const activeSub = session_id ? ccActiveSubagents.get(session_id) : null;
          if (activeSub) sessionKey = `${baseKey}:subagent:${activeSub.agent_id}`;
        }
        for (const block of msgContent) {
          if (block.type === 'text' && block.text?.trim()) {
            eventStore.addEvent({
              type: 'claude-code-text',
              sessionKey,
              text: block.text,
              timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
            });
          }
        }
      } catch {}
    }
    ccLastReadLine.set(session_id, lines.length);
  } catch {}
}

// ─── Helper: locate and read a skill file for security review ────────────────
function readSkillFile(skillName, cwd) {
  if (!skillName || skillName === 'unknown') return null;
  const candidates = [
    path.join(os.homedir(), '.claude', 'skills', `${skillName}.md`),
    path.join(os.homedir(), '.claude', 'skills', skillName),
    cwd ? path.join(cwd, '.claude', 'skills', `${skillName}.md`) : null,
    cwd ? path.join(cwd, '.claude', 'skills', skillName) : null,
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return { content: fs.readFileSync(p, 'utf8').slice(0, 4000), filePath: p };
      }
    } catch {}
  }
  return null;
}
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/hooks/pre-tool-use', rateLimit(60_000, 60), async (req, res) => {
  ccLastHookTime = Date.now();
  console.log(`[GuardClaw] 🔔 pre-tool-use received:`, JSON.stringify(req.body).slice(0, 500));
  const { tool_name, tool_input, session_id } = req.body;
  if (!tool_name) return res.json({});

  const gcToolName = mapClaudeCodeTool(tool_name);
  const gcParams = mapClaudeCodeParams(tool_name, tool_input);
  // If a sub-agent is active for this session, attribute tool calls to it
  const activeSub = session_id ? ccActiveSubagents.get(session_id) : null;
  const sessionKey = session_id
    ? (activeSub ? `claude-code:${session_id}:subagent:${activeSub.agent_id}` : `claude-code:${session_id}`)
    : 'claude-code:default';

  // Infer denials for any stale pending asks from this session
  inferPendingDenials(sessionKey);

  // Cache transcript path for text extraction
  const { transcript_path: txPath } = req.body;
  if (session_id && txPath) ccTranscriptPaths.set(session_id, txPath);

  // Capture any assistant text output before this tool call
  if (session_id) emitIntermediateText(session_id);

  try {
    // Get chain history
    const chainHistory = getChainHistory(sessionKey, gcToolName);

    // Build task context from user prompt, cwd, and recent tool history
    const { cwd, transcript_path } = req.body;
    let userPrompt = lastCCPromptText.get(sessionKey);

    // If no cached prompt (e.g. hook registered after prompt was sent), try reading from transcript
    if (!userPrompt && transcript_path) {
      try {
        const lines = fs.readFileSync(transcript_path, 'utf8').trim().split('\n').filter(Boolean);
        // Scan backwards for the last user message with text content (not tool_result)
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
          try {
            const entry = JSON.parse(lines[i]);
            if (entry.type === 'user' && entry.message?.role === 'user') {
              const content = entry.message.content;
              if (typeof content === 'string' && content.trim()) {
                userPrompt = content.trim().slice(0, 500);
                break;
              }
              if (Array.isArray(content)) {
                const textBlock = content.find(b => b.type === 'text' && b.text?.trim());
                if (textBlock) {
                  userPrompt = textBlock.text.trim().slice(0, 500);
                  break;
                }
              }
            }
          } catch {}
        }
      } catch {}
    }

    // Recent tools in this session (last 5) for context
    const sessionHistory = toolHistoryStore.get(sessionKey) || [];
    const recentTools = sessionHistory.slice(-5).map(h => `${h.toolName}: ${(h.resultSnippet || '').slice(0, 80)}`);

    const taskContext = (userPrompt || cwd || recentTools.length > 0)
      ? { userPrompt: userPrompt || null, cwd: cwd || null, recentTools: recentTools.length > 0 ? recentTools : null }
      : null;

    // Memory lookup
    const commandStr = gcToolName === 'exec' ? (gcParams.command || '') : JSON.stringify(gcParams);
    const mem = memoryStore.lookup(gcToolName, commandStr);
    let memoryHint = null;
    if (mem.found && (mem.approveCount + mem.denyCount) > 0) {
      memoryHint = { pattern: mem.pattern, approveCount: mem.approveCount, denyCount: mem.denyCount, confidence: mem.confidence, suggestedAction: mem.suggestedAction };
    }

    // Auto-approve from memory
    if (memoryHint && memoryHint.suggestedAction === 'auto-approve') {
      const baseScore = 5;
      const adj = memoryStore.getScoreAdjustment(gcToolName, commandStr, baseScore);
      const adjScore = Math.max(1, Math.min(10, baseScore + adj));
      if (adjScore < 9) {
        const compactInput = compactToolInput(gcToolName, gcParams);
        const allowReason = `⛨ GuardClaw ALLOW ${gcToolName}: ${compactInput} (score ${adjScore}, memory)`;
        const emitNotice = shouldEmitAllowNotice(sessionKey, gcToolName, gcParams);
        console.log(`[GuardClaw] 🧠 ${allowReason}`);
        return res.json({
          ...(emitNotice ? { systemMessage: allowReason } : {}),
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: allowReason,
          },
        });
      }
    }

    // Memory context for LLM
    const relatedPatterns = memoryStore.lookupRelated(gcToolName, commandStr);
    const memoryContext = relatedPatterns.length > 0
      ? relatedPatterns.map(p => `- "${p.pattern}" — ${p.approveCount > p.denyCount ? 'safe' : 'risky'} (${p.approveCount}/${p.denyCount})`).join('\n')
      : null;

    // Evaluate
    let analysis;
    if (gcToolName === 'skill') {
      // Skill: read the file content and do LLM-based instruction security review
      const skillName = tool_input?.skill || (gcParams.command || '').replace(/^skill\s+/, '').split(/\s+/)[0] || 'unknown';
      const skillFile = readSkillFile(skillName, cwd);
      if (skillFile) {
        console.log(`[GuardClaw] 🔍 Reviewing skill "${skillName}" (${skillFile.filePath})`);
      } else {
        console.log(`[GuardClaw] 🔍 Skill file not found for "${skillName}", reviewing by name only`);
      }
      analysis = await safeguardService.analyzeSkillContent(skillName, skillFile?.content || null);
    } else if (gcToolName === 'exec') {
      analysis = await safeguardService.analyzeCommand(gcParams.command || '', chainHistory, memoryContext, taskContext);
    } else {
      analysis = await safeguardService.analyzeToolAction({ tool: gcToolName, summary: JSON.stringify(gcParams), ...gcParams }, chainHistory, memoryContext, taskContext);
    }

    // Memory adjustment
    if (memoryHint) {
      const adj = memoryStore.getScoreAdjustment(gcToolName, commandStr, analysis.riskScore);
      if (adj !== 0) {
        analysis.originalRiskScore = analysis.riskScore;
        analysis.riskScore = Math.max(1, Math.min(10, analysis.riskScore + adj));
      }
    }

    // Store event
    const formatDisplayInput = (toolName, params) => {
      switch(toolName) {
        case 'exec': return params.command || '';
        case 'write': return (params.file_path || params.path || '?') + '\n' + (params.content || '').slice(0, 500);
        case 'edit': return (params.file_path || params.path || '?') + ' → ' + (params.old_string || params.oldText || '').slice(0, 200);
        case 'read': return params.file_path || params.path || JSON.stringify(params);
        case 'grep': return `grep "${params.pattern || ''}" ${params.path || ''}`;
        case 'glob': return `glob "${params.pattern || ''}" ${params.path || ''}`;
        case 'tool_search': return `search: ${params.query || ''}`;
        case 'web_fetch': return params.url || JSON.stringify(params);
        case 'web_search': return params.query || JSON.stringify(params);
        default: return JSON.stringify(params);
      }
    };
    const displayInput = formatDisplayInput(gcToolName, gcParams);
    const verdict = analysis.riskScore >= 8 ? (blockingEnabled ? 'ask' : 'pass-through') : 'auto-approved';
    eventStore.addEvent({
      type: 'claude-code-tool',
      tool: gcToolName,
      command: gcToolName === 'exec' ? (gcParams.command || '') : undefined,
      description: displayInput,
      sessionKey,
      riskScore: analysis.riskScore,
      category: analysis.riskScore >= 8 ? 'high-risk' : analysis.riskScore >= 4 ? 'warning' : 'safe',
      allowed: analysis.riskScore < 8 ? 1 : 0,
      safeguard: {
        riskScore: analysis.riskScore,
        reasoning: analysis.reasoning,
        category: analysis.category,
        verdict,
        allowed: analysis.riskScore < 8,
      },
      data: JSON.stringify({
        toolName: gcToolName,
        originalToolName: tool_name,
        payload: { params: gcParams },
        safeguard: { riskScore: analysis.riskScore, reasoning: analysis.reasoning, category: analysis.category, verdict },
        source: 'claude-code',
        timestamp: Date.now(),
      }),
    });

    // Single-direction: auto-allow everything except high-risk
    const CC_PASS_THRESHOLD = parseInt(process.env.GUARDCLAW_CC_PASS_THRESHOLD || '8', 10);

    if (analysis.riskScore < CC_PASS_THRESHOLD) {
      const compactInput = compactToolInput(gcToolName, gcParams);
      const reason = analysis.reasoning || analysis.category || '';
      const msg = `⛨ GuardClaw ALLOW ${gcToolName}: ${compactInput} (score ${analysis.riskScore}) — ${reason}`;
      const emitNotice = shouldEmitAllowNotice(sessionKey, gcToolName, gcParams);
      console.log(`[GuardClaw] ${msg}`);
      return res.json({
        ...(emitNotice ? { systemMessage: msg } : {}),
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: msg,
        },
      });
    }

    // High risk → block directly, GuardClaw is the permission authority
    const blockMsg = `⛨ GuardClaw BLOCKED (score ${analysis.riskScore}): ${analysis.reasoning || analysis.category}`;
    console.log(`[GuardClaw] 🚫 ${blockMsg}`);
    return res.json({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'block',
        permissionDecisionReason: blockMsg,
      },
    });

  } catch (error) {
    console.error('[GuardClaw] Claude Code hook error:', error.message);
    // On error, always pass-through — let Claude Code handle normally
    return res.json({});
  }
});

// Approval management endpoints (unified: CC pendingApprovals + OC approvalHandler)
app.get('/api/approvals/pending', (req, res) => {
  const pending = [];
  // CC approvals
  for (const [id, entry] of pendingApprovals) {
    pending.push({
      id, toolName: entry.toolName, originalToolName: entry.originalToolName,
      displayInput: entry.displayInput, riskScore: entry.riskScore,
      reason: entry.reason, createdAt: entry.createdAt,
      elapsed: Math.round((Date.now() - entry.createdAt) / 1000),
      backend: 'claude-code',
    });
  }
  // OC approvals
  if (approvalHandler) {
    for (const item of approvalHandler.getPendingApprovals()) {
      pending.push({ ...item, backend: 'openclaw' });
    }
  }
  res.json({ pending, count: pending.length });
});

app.post('/api/approvals/:id/approve', (req, res) => {
  const entry = pendingApprovals.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'No pending approval with this id' });
  pendingApprovals.delete(req.params.id);
  entry.resolve({ denied: false });
  // Record in memory, optionally as always-approve
  if (req.body.alwaysApprove) {
    const commandStr = entry.toolName === 'exec' ? (entry.params.command || '') : JSON.stringify(entry.params);
    const result = memoryStore.recordDecision(entry.toolName, entry.displayInput, entry.riskScore, 'approve', entry.sessionKey);
    if (result.commandPattern) memoryStore.setPatternAction(result.commandPattern, 'auto-approve');
  }
  eventStore.notifyListeners({ type: 'approval-resolved', data: JSON.stringify({ id: req.params.id, decision: 'approve' }) });
  console.log(`[GuardClaw] ✅ Claude Code approved: ${entry.originalToolName} (#${req.params.id})`);
  res.json({ ok: true });
});

app.post('/api/approvals/:id/deny', (req, res) => {
  const entry = pendingApprovals.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'No pending approval with this id' });
  pendingApprovals.delete(req.params.id);
  entry.resolve({ denied: true, reason: 'Denied by user' });
  eventStore.notifyListeners({ type: 'approval-resolved', data: JSON.stringify({ id: req.params.id, decision: 'deny' }) });
  console.log(`[GuardClaw] ❌ Claude Code denied: ${entry.originalToolName} (#${req.params.id})`);
  res.json({ ok: true });
});

// Credential patterns for scanning tool output (Read + Bash)
const CONTENT_CREDENTIAL_ALERTS = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, reason: 'Private key detected' },
  { re: /sk-[a-zA-Z0-9]{32,}/, reason: 'OpenAI API key detected' },
  { re: /sk-ant-[a-zA-Z0-9\-]{20,}/, reason: 'Anthropic API key detected' },
  { re: /AKIA[A-Z0-9]{16}/, reason: 'AWS access key ID detected' },
  { re: /ghp_[a-zA-Z0-9]{36}/, reason: 'GitHub personal access token detected' },
  { re: /github_pat_[a-zA-Z0-9_]{82}/, reason: 'GitHub fine-grained token detected' },
  { re: /xox[baprs]-[a-zA-Z0-9\-]{10,}/, reason: 'Slack token detected' },
  { re: /sk_live_[a-zA-Z0-9]{24,}/, reason: 'Stripe live secret key detected' },
  { re: /AIza[a-zA-Z0-9_\-]{35}/, reason: 'Google API key detected' },
  { re: /eyJ[a-zA-Z0-9_\-]+\.eyJ[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+/, reason: 'JWT token detected' },
  { re: /-----BEGIN CERTIFICATE-----/, reason: 'Certificate detected' },
];

// Post-tool-use: store results for chain analysis + scan Read content
app.post('/api/hooks/post-tool-use', rateLimit(60_000, 120), (req, res) => {
  ccLastHookTime = Date.now();
  const { tool_name, tool_input, tool_output, session_id } = req.body;
  if (!tool_name) return res.json({});

  const gcToolName = mapClaudeCodeTool(tool_name);
  const gcParams = mapClaudeCodeParams(tool_name, tool_input);
  const activeSub = session_id ? ccActiveSubagents.get(session_id) : null;
  const sessionKey = session_id
    ? (activeSub ? `claude-code:${session_id}:subagent:${activeSub.agent_id}` : `claude-code:${session_id}`)
    : 'claude-code:default';

  // Check if this tool had a pending 'ask' — PostToolUse means user approved
  const commandStr = gcToolName === 'exec' ? (gcParams.command || '') : JSON.stringify(gcParams);
  const askKey = `${sessionKey}:${gcToolName}:${commandStr.slice(0, 200)}`;
  const pendingAsk = ccPendingAsks.get(askKey);
  if (pendingAsk) {
    ccPendingAsks.delete(askKey);
    memoryStore.recordDecision(pendingAsk.toolName, pendingAsk.displayInput, pendingAsk.riskScore, 'approve', sessionKey);
    console.log(`[GuardClaw] 🧠 Memory: user APPROVED blocked action → ${pendingAsk.toolName}: ${pendingAsk.commandStr.slice(0, 80)}`);
  }
  // Infer denials for any OTHER pending asks in this session (different tools that were denied)
  inferPendingDenials(sessionKey, askKey);

  // Store in toolHistoryStore for chain analysis
  const resultSnippet = typeof tool_output === 'string'
    ? tool_output.slice(0, 500)
    : JSON.stringify(tool_output || '').slice(0, 500);
  addToToolHistory(sessionKey, gcToolName, gcParams, resultSnippet);

  // Scan Read + Bash output for credentials / secrets
  if ((gcToolName === 'read' || gcToolName === 'exec') && tool_output) {
    const content = typeof tool_output === 'string' ? tool_output : JSON.stringify(tool_output);
    const scanSlice = content.slice(0, 10000); // check first 10KB
    const alerts = [];
    for (const { re, reason } of CONTENT_CREDENTIAL_ALERTS) {
      if (re.test(scanSlice)) alerts.push(reason);
    }
    if (alerts.length > 0) {
      const source = gcToolName === 'exec'
        ? `bash: ${(gcParams.command || '').slice(0, 80)}`
        : (tool_input?.file_path || '(unknown)');
      console.log(`[GuardClaw] 🚨 Sensitive content in ${gcToolName} output: ${source} — ${alerts.join(', ')}`);
      eventStore.addEvent({
        type: 'claude-code-tool',
        tool: gcToolName,
        subType: 'content-alert',
        description: `🚨 ${source}`,
        sessionKey,
        riskScore: 8,
        safeguard: {
          riskScore: 8,
          category: 'credential-leak',
          reasoning: `Output contains sensitive data: ${alerts.join('; ')}`,
          allowed: true, // already executed, can't block — flag for chain analysis
          warnings: alerts,
          backend: 'rules',
        },
        timestamp: Date.now(),
      });
    }
  }

  res.json({});
});

// ─── Claude Code conversation hooks ──────────────────────────────────────────

// Prompt injection detection patterns
const PROMPT_INJECTION_PATTERNS = [
  { re: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/i, reason: 'Instruction override attempt' },
  { re: /disregard\s+(?:the\s+)?(?:system|previous|above)\s+(?:prompt|instructions?|rules?)/i, reason: 'System prompt bypass' },
  { re: /you\s+are\s+now\s+(?:a\s+)?(?:different|new|unrestricted|jailbroken)/i, reason: 'Identity override attempt' },
  { re: /(?:system|admin|debug|developer|root)\s+(?:mode|override|access)\s*[:=]/i, reason: 'Privilege escalation prompt' },
  { re: /pretend\s+(?:you(?:'re|\s+are)\s+)?(?:a\s+)?(?:different|unrestricted|evil)/i, reason: 'Jailbreak roleplay attempt' },
  { re: /\bDAN\b.*\bdo\s+anything\s+now\b/i, reason: 'DAN jailbreak pattern' },
  { re: /<\/?(?:system|instruction|prompt|context|rules?)>/i, reason: 'XML tag injection (fake system tags)' },
  { re: /\[SYSTEM\]|\[INST\]|\[\/INST\]/i, reason: 'Chat template injection' },
];

app.post('/api/hooks/user-prompt', rateLimit(60_000, 30), (req, res) => {
  ccLastHookTime = Date.now();
  console.log('[GuardClaw] UserPromptSubmit hook body:', JSON.stringify(req.body).slice(0, 500));
  const { session_id, message } = req.body;
  // Extract user prompt text from message object or legacy prompt field
  const rawPrompt = message?.content || req.body.prompt;
  if (!rawPrompt) return res.json({});
  const sessionKey = session_id ? `claude-code:${session_id}` : 'claude-code:default';
  const promptText = typeof rawPrompt === 'string' ? rawPrompt : JSON.stringify(rawPrompt);

  // Infer denials for any pending asks (user moved on to next prompt)
  inferPendingDenials(sessionKey);

  // Detect prompt injection attempts
  let injectionDetected = false;
  for (const { re, reason } of PROMPT_INJECTION_PATTERNS) {
    if (re.test(promptText)) {
      injectionDetected = true;
      console.log(`[GuardClaw] ⚠️  Prompt injection detected: ${reason} — "${promptText.slice(0, 100)}"`);
      eventStore.addEvent({
        type: 'security-alert',
        subType: 'prompt-injection',
        sessionKey,
        description: `⚠️ ${reason}`,
        text: promptText.slice(0, 500),
        safeguard: {
          riskScore: 7,
          category: 'prompt-injection',
          reasoning: reason,
          backend: 'rules',
        },
        timestamp: Date.now(),
      });
      break; // one alert per prompt is enough
    }
  }

  const promptId = generateId('cc-prompt');
  eventStore.addEvent({
    id: promptId,
    type: 'claude-code-prompt',
    sessionKey,
    text: promptText,
    injectionDetected,
    timestamp: Date.now(),
  });
  lastCCPromptId.set(sessionKey, promptId);   // track for stop-hook reply linking
  lastCCPromptText.set(sessionKey, promptText.slice(0, 500)); // cache for LLM context in pre-tool-use
  res.json({});
});

app.post('/api/hooks/stop', rateLimit(60_000, 30), async (req, res) => {
  const { session_id, transcript_path } = req.body;
  // Respond immediately — don't block CC from continuing
  res.json({});
  if (!transcript_path) return;

  const sessionKey = session_id ? `claude-code:${session_id}` : 'claude-code:default';

  // Cache transcript path so PreToolUse can read intermediate text on future turns
  if (session_id) ccTranscriptPaths.set(session_id, transcript_path);

  // Grab and clear the promptId before any async work to avoid race conditions
  const promptId = lastCCPromptId.get(sessionKey);
  lastCCPromptId.delete(sessionKey);

  // Poll transcript for any remaining assistant text after the last tool call.
  // CC flushes the reply shortly after firing Stop, so poll every 200ms for up to 5s.
  if (!session_id) return;
  try {
    const maxWait = 5000;
    const pollMs = 200;
    const waitStart = Date.now();
    let emitted = false;

    while (Date.now() - waitStart < maxWait) {
      await new Promise(resolve => setTimeout(resolve, pollMs));
      const prevPos = ccLastReadLine.get(session_id) || 0;
      emitIntermediateText(session_id);
      const newPos = ccLastReadLine.get(session_id) || 0;
      if (newPos > prevPos) { emitted = true; break; }
    }

    // If no new text was found via emitIntermediateText, fall back to scanning
    // the last assistant entry for backward compat (emits as claude-code-reply)
    if (!emitted) {
      try {
        const lines = fs.readFileSync(transcript_path, 'utf8').trim().split('\n').filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const entry = JSON.parse(lines[i]);
            if (entry.type !== 'assistant') continue;
            const content = entry.message?.content || entry.content;
            let text = null;
            if (Array.isArray(content)) {
              const block = content.find(b => b.type === 'text' && b.text?.trim());
              text = block?.text || null;
            } else if (typeof content === 'string' && content.trim()) {
              text = content;
            }
            if (text) {
              eventStore.addEvent({
                type: 'claude-code-reply',
                sessionKey,
                text,
                timestamp: Date.now(),
                promptId,
              });
              break;
            }
          } catch {}
        }
      } catch {}
    }
  } catch {}
});

// ─── SubagentStart / SubagentStop hooks ──────────────────────────────────────

app.post('/api/hooks/subagent-start', (req, res) => {
  const { session_id, agent_id, agent_type } = req.body;
  console.log(`[GuardClaw] 🤖 SubagentStart: session=${session_id} agent_id=${agent_id} type=${agent_type}`);

  if (session_id && agent_id) {
    ccActiveSubagents.set(session_id, { agent_id, agent_type: agent_type || 'unknown', startTime: Date.now() });

    const parentKey = `claude-code:${session_id}`;
    const subKey = `claude-code:${session_id}:subagent:${agent_id}`;
    eventStore.addEvent({
      type: 'claude-code-tool',
      tool: 'subagent_start',
      description: `Sub-agent started: ${agent_type || 'unknown'}`,
      sessionKey: subKey,
      parentSessionKey: parentKey,
      agentType: agent_type,
      agentId: agent_id,
      timestamp: Date.now(),
      safeguard: { riskScore: 1, category: 'safe', allowed: true, backend: 'rules' },
    });
  }

  res.json({});
});

app.post('/api/hooks/subagent-stop', (req, res) => {
  const { session_id, agent_id, agent_type, last_assistant_message } = req.body;
  console.log(`[GuardClaw] 🤖 SubagentStop: session=${session_id} agent_id=${agent_id} type=${agent_type}`);

  if (session_id && agent_id) {
    const activeSub = ccActiveSubagents.get(session_id);
    ccActiveSubagents.delete(session_id);

    const parentKey = `claude-code:${session_id}`;
    const subKey = `claude-code:${session_id}:subagent:${agent_id}`;
    eventStore.addEvent({
      type: 'claude-code-tool',
      tool: 'subagent_stop',
      description: `Sub-agent finished: ${agent_type || 'unknown'}`,
      sessionKey: subKey,
      parentSessionKey: parentKey,
      agentType: agent_type,
      agentId: agent_id,
      duration: activeSub ? Date.now() - activeSub.startTime : null,
      resultPreview: typeof last_assistant_message === 'string' ? last_assistant_message.slice(0, 500) : null,
      timestamp: Date.now(),
      safeguard: { riskScore: 1, category: 'safe', allowed: true, backend: 'rules' },
    });
  }

  res.json({});
});

// ─── LLM input hook: capture user prompts from all channels (incl webchat) ───

app.post('/api/hooks/llm-input', (req, res) => {
  const { sessionKey, runId, provider, model, prompt, imagesCount, historyLength } = req.body;
  const key = sessionKey || 'agent:main:main';
  const truncated = typeof prompt === 'string' ? prompt.slice(0, 2000) : '';
  console.log(`[GuardClaw] 💬 llm-input: session=${key}, model=${model}, prompt_len=${truncated.length}, history=${historyLength}`);

  eventStore.addEvent({
    type: 'user-message',
    sessionKey: key,
    content: truncated,
    from: 'user',
    model,
    provider,
    runId,
    imagesCount: imagesCount || 0,
    historyLength: historyLength || 0,
    timestamp: Date.now(),
  });

  res.json({});
});

// ─── LLM output hook: token tracking ──────────────────────

app.post('/api/hooks/llm-output', (req, res) => {
  const { sessionKey, usage, provider, model } = req.body;
  if (!usage) return res.json({});

  // Determine backend from sessionKey
  let backend = 'openclaw';
  if (sessionKey?.startsWith('claude-code:')) backend = 'claude-code';
  else if (sessionKey?.startsWith('nanobot')) backend = 'nanobot';

  eventStore.recordAgentTokens(backend, {
    input: usage.input_tokens || usage.prompt_tokens || usage.input || 0,
    output: usage.output_tokens || usage.completion_tokens || usage.output || 0,
    cacheRead: usage.cache_read_input_tokens || usage.cache_read || usage.cacheRead || 0,
    cacheWrite: usage.cache_creation_input_tokens || usage.cache_write || usage.cacheWrite || 0,
  });

  res.json({});
});

// ─── Message hooks: user message + agent reply tracking ──────────────────────

app.post('/api/hooks/message-received', (req, res) => {
  const { sessionKey, from, content, timestamp, metadata, channelId } = req.body;
  // Normalize: webchat messages belong to main agent session
  const rawKey = sessionKey || 'agent:main:main';
  const key = rawKey === 'agent:main:webchat' || rawKey.includes('webchat') ? 'agent:main:main' : rawKey;
  const truncated = typeof content === 'string'
    ? content.substring(0, 2000)
    : JSON.stringify(content || '').substring(0, 2000);
  console.log(`[GuardClaw] 💬 message-received: from=${from}, session=${key} (raw=${rawKey}), len=${truncated.length}`);

  eventStore.addEvent({
    type: 'user-message',
    sessionKey: key,
    from,
    content: truncated,
    channelId,
    timestamp: timestamp ? new Date(timestamp).getTime() : Date.now(),
  });

  res.json({ ok: true });
});

app.post('/api/hooks/message-sending', (req, res) => {
  const { sessionKey, to, content, metadata } = req.body;
  const rawKey = sessionKey || 'agent:main:main';
  const key = rawKey === 'agent:main:webchat' || rawKey.includes('webchat') ? 'agent:main:main' : rawKey;
  const truncated = typeof content === 'string'
    ? content.substring(0, 2000)
    : JSON.stringify(content || '').substring(0, 2000);
  console.log(`[GuardClaw] 🤖 message-sending: to=${to}, session=${key}, len=${truncated.length}`);

  eventStore.addEvent({
    type: 'agent-reply',
    sessionKey: key,
    to,
    content: truncated,
    timestamp: Date.now(),
  });

  res.json({ ok: true });
});

app.post('/api/hooks/message-sent', (req, res) => {
  const { sessionKey, to, content, success, error } = req.body;
  console.log(`[GuardClaw] ✅ message-sent: to=${to}, session=${sessionKey}, success=${success}`);
  // Just log — we already stored the agent-reply event in message-sending
  res.json({ ok: true });
});

// ─── Chat Inject API (used by plugin to trigger agent retry after approval) ──

app.post('/api/chat-inject', async (req, res) => {
  const { sessionKey, message } = req.body;
  if (!sessionKey || !message) {
    return res.status(400).json({ error: 'sessionKey and message required' });
  }
  if (!openclawClient || !openclawClient.connected) {
    return res.status(503).json({ error: 'OpenClaw not connected' });
  }
  try {
    const idempotencyKey = generateId('guardclaw-retry');
    await openclawClient.request('chat.send', {
      sessionKey,
      message,
      idempotencyKey,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[GuardClaw] chat-inject failed:', err);
    res.status(500).json({ error: err.message });
  }
});


// ─── Extracted Route Modules ─────────────────────────────────────────────────
const routeDeps = {
  getOpenclawClient: () => openclawClient,
  getSafeguardService: () => safeguardService,
  setSafeguardService: (s) => { Object.assign(safeguardService, s); },
  getFailClosed: () => failClosedEnabled,
  setFailClosed: (v) => { failClosedEnabled = v; },
  getBenchmarkStore: () => benchmarkStore,
};
app.use(configRoutes(routeDeps));
app.use(benchmarkRoutes(routeDeps));
app.use('/api/models', modelsRouter);

// Auto-switch to built-in backend when a model is loaded
// Persist token usage to SQLite
llmEngine._onTokenUsage = (prompt, completion) => {
  eventStore.incrementCounter('token_prompt', prompt);
  eventStore.incrementCounter('token_completion', completion);
  eventStore.incrementCounter('token_requests', 1);
};

setBackendSwitcher(() => {
  if (safeguardService.backend !== 'built-in') {
    console.log('[GuardClaw] Built-in model loaded — auto-switching backend to built-in');
    safeguardService.backend = 'built-in';
    safeguardService._llmClient = null; // force re-init on next call
  }
});

// ─── Approval APIs (OC-specific) ────────────────────────────────────────────

app.get('/api/approvals/stats', (req, res) => {
  if (!approvalHandler) {
    return res.status(503).json({ error: 'Approval handler not available' });
  }
  const stats = approvalHandler.getStats();
  res.json(stats);
});

app.post('/api/approvals/resolve', async (req, res) => {
  if (!approvalHandler) {
    return res.status(503).json({ error: 'Approval handler not available' });
  }
  
  const { approvalId, action } = req.body;
  
  if (!approvalId || !action) {
    return res.status(400).json({ error: 'Missing approvalId or action' });
  }
  
  if (!['allow-once', 'allow-always', 'deny'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Must be allow-once, allow-always, or deny' });
  }
  
  try {
    await approvalHandler.userResolve(approvalId, action);
    res.json({ success: true, approvalId, action });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Memory APIs ─────────────────────────────────────────────────────────────

app.get('/api/memory/stats', (req, res) => {
  res.json(memoryStore.getStats());
});

app.get('/api/memory/decisions', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ decisions: memoryStore.getDecisions(limit) });
});

app.get('/api/memory/patterns', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const toolName = req.query.tool || null;
  const patterns = toolName
    ? memoryStore.getPatternsByTool(toolName)
    : memoryStore.getPatterns(limit);
  res.json({ patterns });
});

app.get('/api/memory/lookup', (req, res) => {
  const { tool, command } = req.query;
  if (!tool || !command) {
    return res.status(400).json({ error: 'Missing tool or command query param' });
  }
  res.json(memoryStore.lookup(tool, command));
});

app.post('/api/memory/record', (req, res) => {
  const { toolName, command, riskScore, decision, sessionKey, alwaysApprove } = req.body;
  if (!toolName || !decision) {
    return res.status(400).json({ error: 'Missing toolName or decision' });
  }
  // 'neutral' = user un-marked: delete the pattern entirely
  if (decision === 'neutral') {
    const result = memoryStore.resetPattern(toolName, command);
    return res.json({ ok: true, ...result });
  }
  const result = memoryStore.recordDecision(toolName, command, riskScore, decision, sessionKey);

  // If alwaysApprove, force the pattern to auto-approve immediately
  if (alwaysApprove && result.commandPattern) {
    memoryStore.setPatternAction(result.commandPattern, 'auto-approve');
    console.log(`[Memory] 🔒 Pattern permanently trusted: ${result.commandPattern}`);
  }

  res.json({ ok: true, ...result });
});

app.get('/api/rules/suggestions', async (req, res) => {
  try {
    const patterns = memoryStore.getPatterns(200);

    // Aggregate by tool + directory/category instead of individual commands
    const toolGroups = {};
    for (const p of patterns) {
      const total = (p.approveCount || 0) + (p.denyCount || 0);
      if (total < 1) continue;
      const tool = p.toolName || 'unknown';
      // Extract directory from pattern: "edit:~/guardclaw/server/foo.js" → "~/guardclaw/server/"
      let dir = '';
      const match = p.pattern?.match(/^[^:]+:(.+)/);
      if (match) {
        const path = match[1];
        const lastSlash = path.lastIndexOf('/');
        dir = lastSlash > 0 ? path.substring(0, lastSlash + 1) : '';
      }
      const key = `${tool}:${dir || '*'}`;
      if (!toolGroups[key]) {
        toolGroups[key] = { tool, dir, approves: 0, denies: 0, count: 0 };
      }
      toolGroups[key].approves += (p.approveCount || 0);
      toolGroups[key].denies += (p.denyCount || 0);
      toolGroups[key].count++;
    }

    const suggestions = [];
    for (const [key, g] of Object.entries(toolGroups)) {
      const total = g.approves + g.denies;
      if (total < 3) continue; // Need meaningful data
      const approveRate = g.approves / total;
      const displayPattern = g.dir ? `${g.tool}:${g.dir}*` : g.tool;

      if (approveRate >= 0.8) {
        suggestions.push({
          type: 'whitelist',
          pattern: displayPattern,
          toolName: g.tool,
          reason: `Approved ${g.approves}/${total} times across ${g.count} patterns`,
          approveCount: g.approves,
          denyCount: g.denies,
        });
      } else if (approveRate <= 0.2) {
        suggestions.push({
          type: 'blacklist',
          pattern: displayPattern,
          toolName: g.tool,
          reason: `Denied ${g.denies}/${total} times across ${g.count} patterns`,
          approveCount: g.approves,
          denyCount: g.denies,
        });
      }
    }

    // LLM-generated suggestions (if requested)
    const useLLM = req.query.llm === 'true';
    if (useLLM) {
      try {
        const summary = patterns.slice(0, 50).map(p => {
          const total = (p.approveCount || 0) + (p.denyCount || 0);
          return `${p.toolName}:${p.pattern?.split(':').slice(1).join(':') || '?'} — ${p.approveCount}✓ ${p.denyCount}✗`;
        }).join('\n');

        const messages = [
          { role: 'system', content: 'You are a security rule advisor. Output ONLY a JSON array, no markdown.' },
          { role: 'user', content: `Based on this approve/deny history, suggest 3-5 useful security rules.
Each rule should be a concise pattern (tool name or tool:path_glob) with a clear reason.

HISTORY:
${summary}

Output JSON array:
[{"type":"whitelist or blacklist","pattern":"tool:pattern","reason":"short reason"}]` }
        ];

        // Use whatever LLM the safeguard is currently using
        const rawText = await safeguardService.rawLLMChat(messages);
        const result = { choices: [{ message: { content: rawText || '[]' } }] };

        const text = result?.choices?.[0]?.message?.content || '';
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          const llmSuggestions = JSON.parse(match[0]);
          for (const s of llmSuggestions) {
            if (s.pattern && s.type && s.reason) {
              suggestions.push({ ...s, toolName: s.pattern.split(':')[0], source: 'llm' });
            }
          }
        }
      } catch (e) {
        console.error('[Rules] LLM suggestion failed:', e.message);
      }
    }

    res.json({ suggestions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/memory/reset', (req, res) => {
  memoryStore.reset();
  res.json({ ok: true, message: 'Memory cleared' });
});

// Fail-closed toggle API
app.post('/api/config/fail-closed', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  failClosedEnabled = enabled;
  // Persist to .env so it survives restarts
  try {
    const envPath = path.join(getDataDir(), '.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    if (envContent.includes('GUARDCLAW_FAIL_CLOSED=')) {
      envContent = envContent.replace(/GUARDCLAW_FAIL_CLOSED=.*/, `GUARDCLAW_FAIL_CLOSED=${enabled}`);
    } else {
      envContent += `\nGUARDCLAW_FAIL_CLOSED=${enabled}\n`;
    }
    fs.writeFileSync(envPath, envContent);
  } catch (err) {
    console.warn('[GuardClaw] Could not persist fail-closed setting:', err.message);
  }
  console.log(`[GuardClaw] Fail-closed ${enabled ? 'enabled' : 'disabled'}`);
  res.json({ ok: true, failClosed: failClosedEnabled });
});

// Claude Code hook setup API
app.post('/api/setup/claude-code', (req, res) => {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const claudeDir = path.join(os.homedir(), '.claude');
    const port = process.env.PORT || '3002';

    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    let settings = {};
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
    if (!settings.hooks) settings.hooks = {};

    const isGCHook = (g) => g?.hooks?.some(h => h.url?.includes('/api/hooks/'));

    // Remove existing GuardClaw hooks
    for (const event of ['PreToolUse', 'PostToolUse', 'Stop', 'Notification', 'UserPromptSubmit']) {
      if (Array.isArray(settings.hooks[event])) {
        settings.hooks[event] = settings.hooks[event].filter(g => !isGCHook(g));
      }
    }

    // Add hooks
    const hooks = {
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/api/hooks/pre-tool-use`, timeout: 300, statusMessage: '⏳ GuardClaw evaluating...' }] }],
      PostToolUse: [{ matcher: '*', hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/api/hooks/post-tool-use`, timeout: 10 }] }],
      Stop: [{ matcher: '*', hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/api/hooks/stop`, timeout: 10 }] }],
      UserPromptSubmit: [{ matcher: '*', hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/api/hooks/user-prompt`, timeout: 5 }] }],
    };
    for (const [event, groups] of Object.entries(hooks)) {
      if (!settings.hooks[event]) settings.hooks[event] = [];
      settings.hooks[event].push(...groups);
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    console.log(`[GuardClaw] Claude Code hooks installed at ${settingsPath}`);
    res.json({ ok: true, path: settingsPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/setup/claude-code/status', (req, res) => {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      return res.json({ installed: false });
    }
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const hasHooks = settings.hooks?.PreToolUse?.some(g =>
      g.hooks?.some(h => h.url?.includes('/api/hooks/pre-tool-use'))
    );
    res.json({ installed: !!hasHooks, path: settingsPath });
  } catch {
    res.json({ installed: false });
  }
});

// OpenClaw plugin setup API
app.post('/api/setup/openclaw', (req, res) => {
  try {
    const pluginId = 'guardclaw-interceptor';
    const destDir = path.join(os.homedir(), '.openclaw', 'plugins', pluginId);
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');

    // Find plugin source: embedded in app bundle or dev source tree
    let srcDir = null;
    const candidates = [
      path.join(path.dirname(process.argv[1] || ''), 'plugin', pluginId),  // embedded backend
      path.join(import.meta.dirname, '..', 'plugin', pluginId),            // dev source tree
    ];
    for (const c of candidates) {
      if (fs.existsSync(path.join(c, 'index.js'))) { srcDir = c; break; }
    }
    if (!srcDir) {
      return res.status(404).json({ error: 'Plugin source not found in app bundle' });
    }

    // Copy plugin files to ~/.openclaw/plugins/guardclaw-interceptor/
    fs.mkdirSync(destDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir)) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    }
    console.log(`[GuardClaw] OC plugin copied to ${destDir}`);

    // Register in openclaw.json
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!config.plugins) config.plugins = {};
      if (!config.plugins.allow) config.plugins.allow = [];
      if (!config.plugins.allow.includes(pluginId)) config.plugins.allow.push(pluginId);
      if (!config.plugins.load) config.plugins.load = {};
      if (!config.plugins.load.paths) config.plugins.load.paths = [];
      if (!config.plugins.load.paths.includes(destDir)) config.plugins.load.paths.push(destDir);
      if (!config.plugins.entries) config.plugins.entries = {};
      config.plugins.entries[pluginId] = { enabled: true };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      console.log(`[GuardClaw] OC plugin registered in ${configPath}`);
    } else {
      console.warn(`[GuardClaw] openclaw.json not found at ${configPath}, plugin files copied but not registered`);
    }

    res.json({ ok: true, path: destDir });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/setup/openclaw/status', (req, res) => {
  try {
    const pluginDir = path.join(os.homedir(), '.openclaw', 'plugins', 'guardclaw-interceptor');
    const hasFiles = fs.existsSync(path.join(pluginDir, 'index.js'));
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    let registered = false;
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      registered = config.plugins?.entries?.['guardclaw-interceptor']?.enabled === true;
    }
    res.json({ installed: hasFiles && registered, path: pluginDir });
  } catch {
    res.json({ installed: false });
  }
});

// Security scan endpoint
// Suspicious patterns for deep content scanning
const SUSPICIOUS_CODE_PATTERNS = [
  { re: /\b(curl|wget|nc|ncat|netcat)\s+/g, reason: 'Network exfiltration command', severity: 'high' },
  { re: /https?:\/\/[^\s"']+/g, reason: 'External URL reference', severity: 'medium' },
  { re: /wss?:\/\/[^\s"']+/g, reason: 'WebSocket URL reference', severity: 'high' },
  { re: /\beval\s*\(|exec\s*\(|os\.system\s*\(|subprocess\.\w+\s*\(/g, reason: 'Dynamic code execution', severity: 'high' },
  { re: /\b(base64|btoa|atob)\b/g, reason: 'Encoding/obfuscation detected', severity: 'medium' },
  { re: /\b(credentials|password|secret|token|api_key|apikey|private_key)\b/gi, reason: 'Credential reference', severity: 'medium' },
  { re: /\b(\.ssh|\.aws|\.env|\.gnupg|keychain)\b/g, reason: 'Sensitive path reference', severity: 'high' },
  { re: /\bchmod\s+[0-7]*7[0-7]*\b|chmod\s+\+x/g, reason: 'Permission escalation', severity: 'medium' },
  { re: /\brm\s+-rf?\s+[\/~]/g, reason: 'Destructive file deletion', severity: 'high' },
];

/** Deep-scan a directory of skills/plugins, reading file content */
function deepScanDirectory(dirPath, category, maxFiles = 50) {
  const findings = [];
  if (!fs.existsSync(dirPath)) return findings;

  let fileCount = 0;
  const scanFile = (filePath, skillName) => {
    if (fileCount >= maxFiles) return;
    if (!filePath.match(/\.(json|yaml|yml|js|ts|py|sh|md|txt)$/)) return;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 500000) return; // skip files > 500KB
      fileCount++;
      const content = fs.readFileSync(filePath, 'utf8');
      for (const pattern of SUSPICIOUS_CODE_PATTERNS) {
        const matches = content.match(pattern.re);
        if (matches) {
          // Find line number of first match
          const idx = content.search(pattern.re);
          const line = idx >= 0 ? content.substring(0, idx).split('\n').length : 0;
          const snippet = content.split('\n').slice(Math.max(0, line - 2), line + 1).join('\n').substring(0, 200);
          findings.push({
            id: `${category}-${skillName}-${pattern.reason}`.replace(/\s+/g, '-').toLowerCase(),
            category,
            severity: pattern.severity,
            title: `${pattern.reason} in ${skillName}`,
            detail: `File: ${filePath}:${line}\nMatches: ${matches.slice(0, 3).join(', ')}`,
            snippet,
            recommendation: `Review ${skillName} for ${pattern.reason.toLowerCase()}.`
          });
        }
      }
    } catch {}
  };

  try {
    for (const entry of fs.readdirSync(dirPath)) {
      const entryPath = path.join(dirPath, entry);
      try {
        const stat = fs.statSync(entryPath);
        if (stat.isDirectory()) {
          for (const sub of fs.readdirSync(entryPath)) {
            scanFile(path.join(entryPath, sub), entry);
          }
        } else {
          scanFile(entryPath, entry);
        }
      } catch {}
    }
  } catch {}
  return findings;
}

app.post('/api/setup/security-scan', async (_req, res) => {
  const findings = [];
  const scannedItems = { mcpServers: 0, skills: 0, hooks: 0, ocComponents: 0 };

  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

      // MCP Servers — check each server's command, args, env
      const mcpServers = settings.mcpServers || {};
      for (const [name, cfg] of Object.entries(mcpServers)) {
        scannedItems.mcpServers++;
        const args = (cfg.args || []).join(' ');
        const cmd = cfg.command || '';
        const env = JSON.stringify(cfg.env || {});

        // Remote URL check
        const allText = `${cmd} ${args} ${env}`;
        if (/https?:\/\/|wss?:\/\//.test(allText)) {
          findings.push({
            id: `mcp-remote-${name}`,
            category: 'MCP Servers',
            severity: 'high',
            title: `Remote MCP server: ${name}`,
            detail: `Command: ${cmd} ${args}`,
            recommendation: 'Remote MCP servers can intercept and exfiltrate all tool calls. Only use trusted servers.'
          });
        }
        // Unrecognized command check
        const knownCmds = ['npx', 'node', 'python', 'python3', 'uvx', 'docker', 'deno', 'bun'];
        const baseName = path.basename(cmd);
        if (cmd && !knownCmds.includes(baseName)) {
          findings.push({
            id: `mcp-cmd-${name}`,
            category: 'MCP Servers',
            severity: 'medium',
            title: `Uncommon MCP command: ${name}`,
            detail: `Command: ${cmd} ${args}`,
            recommendation: 'Verify this MCP server binary is from a trusted source.'
          });
        }
      }

      // Skills — deep scan: read each skill's description, files, and code content
      const skills = settings.skills || {};
      const claudeSkillsDir = path.join(os.homedir(), '.claude', 'skills');
      for (const [name, skill] of Object.entries(skills)) {
        scannedItems.skills++;
        const skillStr = JSON.stringify(skill);

        // Check description and config for suspicious patterns
        for (const pattern of SUSPICIOUS_CODE_PATTERNS) {
          if (pattern.re.test(skillStr)) {
            pattern.re.lastIndex = 0;
            findings.push({
              id: `skill-config-${name}-${pattern.reason}`.replace(/\s+/g, '-').toLowerCase(),
              category: 'Claude Code Skills',
              severity: pattern.severity,
              title: `${pattern.reason} in skill config: ${name}`,
              detail: skillStr.substring(0, 300),
              recommendation: `Review skill "${name}" configuration for ${pattern.reason.toLowerCase()}.`
            });
          }
          pattern.re.lastIndex = 0;
        }
      }
      // Deep scan skill files on disk
      if (fs.existsSync(claudeSkillsDir)) {
        findings.push(...deepScanDirectory(claudeSkillsDir, 'Claude Code Skills'));
      }

      // Hooks — deep analysis
      const hooks = settings.hooks || {};
      for (const [hookName, hookList] of Object.entries(hooks)) {
        for (const hook of (Array.isArray(hookList) ? hookList : [])) {
          scannedItems.hooks++;
          const cmd = hook.command || '';
          for (const pattern of SUSPICIOUS_CODE_PATTERNS) {
            if (pattern.re.test(cmd)) {
              pattern.re.lastIndex = 0;
              findings.push({
                id: `hook-${hookName}-${cmd.substring(0, 20)}`.replace(/\s+/g, '-'),
                category: 'Claude Code Hooks',
                severity: pattern.severity,
                title: `${pattern.reason} in hook: ${hookName}`,
                detail: cmd.substring(0, 300),
                recommendation: `Review this hook. ${pattern.reason} can be used for data exfiltration.`
              });
            }
            pattern.re.lastIndex = 0;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[GuardClaw] Security scan: failed to read Claude settings:', err.message);
  }

  // OpenClaw: deep scan skills, extensions, plugins directories
  const ocDir = path.join(os.homedir(), 'openclaw');
  for (const subdir of ['skills', 'extensions', 'plugins']) {
    const subdirPath = path.join(ocDir, subdir);
    if (fs.existsSync(subdirPath)) {
      try {
        scannedItems.ocComponents += fs.readdirSync(subdirPath).length;
      } catch {}
      const label = `OpenClaw ${subdir.charAt(0).toUpperCase() + subdir.slice(1)}`;
      findings.push(...deepScanDirectory(subdirPath, label));
    }
  }

  // Deduplicate findings by id
  const seen = new Set();
  const deduped = findings.filter(f => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });

  res.json({
    ok: true,
    findings: deduped,
    scannedItems,
    summary: {
      categories: new Set(deduped.map(f => f.category)).size,
      total: deduped.length,
      recommendations: deduped.length,
      mcpServers: scannedItems.mcpServers,
      skills: scannedItems.skills,
      hooks: scannedItems.hooks,
      ocComponents: scannedItems.ocComponents,
    }
  });
});

// Agent Audit scan (powered by agent-audit Python package)
// Cached audit scan results
let cachedAuditResult = null;
let auditScanProgress = { phase: 'idle', current: 0, total: 0, message: '' };

const AUDIT_CACHE_PATH = path.join(getGuardClawDir(), 'audit-cache.json');

/** Compute a hash of scanned directories based on top-level entry count + mtimes */
function computeScanHash(dirs) {
  const hash = crypto.createHash('md5');
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      // Only scan top-level + one level deep (skip node_modules etc)
      const entries = fs.readdirSync(dir).filter(e => !e.startsWith('.') && e !== 'node_modules' && e !== 'dist');
      hash.update(`${dir}:${entries.length}:`);
      for (const entry of entries) {
        try {
          const fullPath = path.join(dir, entry);
          const st = fs.statSync(fullPath);
          hash.update(`${entry}:${st.mtimeMs}:`);
          // One level deep for subdirs
          if (st.isDirectory()) {
            try {
              const subs = fs.readdirSync(fullPath);
              hash.update(`${subs.length}:`);
              for (const sub of subs.slice(0, 20)) {
                try {
                  const subSt = fs.statSync(path.join(fullPath, sub));
                  hash.update(`${subSt.mtimeMs}:`);
                } catch {}
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }
  return hash.digest('hex');
}

/** Load cached scan results from disk */
function loadAuditCache() {
  try {
    if (fs.existsSync(AUDIT_CACHE_PATH)) {
      const data = JSON.parse(fs.readFileSync(AUDIT_CACHE_PATH, 'utf8'));
      if (data.result && data.hash) return data;
    }
  } catch {}
  return null;
}

/** Save scan results to disk */
function saveAuditCache(hash, result) {
  try {
    const dir = path.dirname(AUDIT_CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUDIT_CACHE_PATH, JSON.stringify({ hash, result, savedAt: Date.now() }, null, 2));
  } catch (e) {
    console.warn('[GuardClaw] Failed to save audit cache:', e.message);
  }
}

/** LLM judge review of scan findings — enriches with verdict + better explanation */
async function llmReviewFindings(findings) {
  if (!findings.length) return findings;
  // Only review critical findings + top high findings (cap at 15 for speed)
  const critical = findings.filter(f => f.severity === 'critical');
  const high = findings.filter(f => f.severity === 'high');
  const toReview = [...critical, ...high.slice(0, Math.max(0, 15 - critical.length))];
  if (!toReview.length) return findings;

  const lmUrl = safeguardService?.config?.lmstudioUrl;
  if (!lmUrl) return findings;

  // Get first available model
  let model = safeguardService?.config?.lmstudioModel || 'auto';
  if (model === 'auto') {
    try {
      model = await safeguardService.getFirstAvailableLMStudioModel();
    } catch { return findings; }
  }
  if (!model) return findings;

  console.log(`[SecurityScan] LLM reviewing ${toReview.length} high/critical findings...`);
  auditScanProgress = { phase: 'llm-review', current: 0, total: toReview.length, message: `Reviewing ${toReview.length} findings with LLM...` };

  for (let i = 0; i < toReview.length; i++) {
    const finding = toReview[i];
    auditScanProgress.current = i + 1;
    auditScanProgress.message = `LLM reviewing ${i + 1}/${toReview.length}: ${finding.title?.substring(0, 50) || 'finding'}`;
    try {
      const prompt = `You are a security auditor reviewing a static analysis finding for an AI agent plugin/skill.

FINDING:
- Title: ${finding.title}
- Severity: ${finding.severity}
- Description: ${finding.description || ''}
- File: ${finding.filePath || ''}
- Code snippet: ${finding.snippet || 'N/A'}
- Source: ${finding.source || ''} ${finding.sourceName || ''}

Determine if this is a TRUE security risk or a FALSE POSITIVE.

RULES (check in order):
1. TEST FILES: If the file path ends with .test.ts, .test.js, .spec.ts, .spec.js, or is inside __tests__/ or /test/ directory → almost always FALSE_POSITIVE. Test files use mock/dummy credentials for unit testing. Even if the snippet contains "PRIVATE KEY" or "sk-" headers, test fixtures are NOT real secrets. Only mark TRUE_RISK if you see a REAL 2048+ bit key or 40+ char high-entropy token.
2. DOCUMENTATION: .md files containing example connection strings like "postgres://user:pass@localhost" are TRUE_RISK if the credentials look production-ready, FALSE_POSITIVE if clearly example/placeholder (e.g. "user:password@localhost").
3. REDACTED SNIPPETS: If the snippet shows "----*******************----" that means the actual content was redacted by the scanner. Do NOT assume redacted content is high-entropy — it was masked regardless of actual content.
4. For all other files: Is the code actually dangerous in context?

Output ONLY valid JSON:
{"verdict":"TRUE_RISK|FALSE_POSITIVE|NEEDS_REVIEW","confidence":0.0-1.0,"explanation":"1-2 sentences explaining why"}`;

      // Retry up to 2 times with 30s timeout
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 30000);
          const resp = await fetch(`${lmUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: '/no_think\nYou are a security auditor. Output ONLY valid JSON, no markdown, no explanations outside JSON.' },
                { role: 'user', content: prompt }
              ],
              temperature: 0.1,
              max_tokens: 200
            })
          });
          clearTimeout(timer);

          if (resp.ok) {
            const data = await resp.json();
            const text = data.choices?.[0]?.message?.content || '';
            const jsonMatch = text.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
              const review = JSON.parse(jsonMatch[0]);
              finding.llmVerdict = review.verdict;
              finding.llmConfidence = review.confidence;
              finding.llmExplanation = review.explanation;
              break; // Success, no retry needed
            }
          }
        } catch (e) {
          if (attempt === 0) continue; // Retry once
        }
      }
    } catch (e) {
      // LLM failed after retries
    }
    // If no verdict was set, default to TRUE_RISK (conservative)
    if (!finding.llmVerdict) {
      finding.llmVerdict = 'TRUE_RISK';
      finding.llmConfidence = 0.5;
      finding.llmExplanation = 'LLM review unavailable — treating as potential risk.';
    }
  }

  const trueRisks = toReview.filter(f => f.llmVerdict === 'TRUE_RISK').length;
  const falsePos = toReview.filter(f => f.llmVerdict === 'FALSE_POSITIVE').length;
  console.log(`[SecurityScan] LLM review done: ${trueRisks} true risks, ${falsePos} false positives, ${toReview.length - trueRisks - falsePos} needs review`);
  auditScanProgress = { phase: 'done', current: 0, total: 0, message: 'Scan complete' };

  return findings;
}

async function runAuditScan(scanPath, forceRescan = false) {
  const targets = [];
  targets.push(path.join(os.homedir(), '.claude'));
  // Scan OpenClaw codebase if available
  const ocPath = path.join(os.homedir(), 'openclaw');
  if (fs.existsSync(ocPath)) {
    targets.push(ocPath);
  }
  if (scanPath && fs.existsSync(scanPath)) {
    targets.push(scanPath);
  }

  // Check if we can use cached results (no changes detected)
  if (!forceRescan) {
    const currentHash = computeScanHash(targets);
    const cached = loadAuditCache();
    if (cached && cached.hash === currentHash) {
      console.log('[SecurityScan] No changes detected, using cached results');
      cachedAuditResult = cached.result;
      return cached.result;
    }
  }

  // Find Python: bundled in app → homebrew → system
  const pythonCandidates = [
    path.join(path.dirname(process.execPath), '..', 'python-env', 'bin', 'python3'),
    '/opt/homebrew/opt/python@3.13/bin/python3.13',
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
  ];
  const python = pythonCandidates.find(p => fs.existsSync(p));
  if (!python) {
    return { ok: false, findings: [], summary: null, error: 'Python not found. Install Python 3 to enable security scanning.' };
  }
  const allFindings = [];
  let scanError = null;

  auditScanProgress = { phase: 'scanning', current: 0, total: targets.length, message: 'Running static analysis...' };
  for (const target of targets) {
    auditScanProgress.current++;
    auditScanProgress.message = `Scanning ${path.basename(target)}...`;
    try {
      const result = await new Promise((resolve, reject) => {
        const child = childProcess.spawn(python, [
          '-m', 'agent_audit.cli.main', 'scan', target,
          '--format', 'json', '--min-tier', 'warn'
        ], { timeout: 60000 });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => stdout += d);
        child.stderr.on('data', d => stderr += d);
        child.on('close', code => {
          if (stdout.trim()) {
            try {
              resolve(JSON.parse(stdout));
            } catch {
              reject(new Error(`Failed to parse agent-audit output: ${stdout.substring(0, 200)}`));
            }
          } else {
            reject(new Error(stderr || `agent-audit exited with code ${code}`));
          }
        });
        child.on('error', reject);
      });

      if (result.findings) {
        for (const f of result.findings) {
          if (f.confidence < 0.2) continue;

          const fp = f.location?.file_path || '';
          let source = null;
          let sourceName = null;
          let skillName = null;
          const officialMatch = fp.match(/plugins\/marketplaces\/claude-plugins-official\/plugins\/([^/]+)/);
          const externalMatch = fp.match(/plugins\/marketplaces\/claude-plugins-official\/external_plugins\/([^/]+)/);
          const ocSkillMatch = fp.match(/openclaw\/skills\/([^/]+)/);
          const ocExtMatch = fp.match(/openclaw\/extensions\/([^/]+)/);
          const ocPluginMatch = fp.match(/openclaw\/plugins\/([^/]+)/);
          const ccSkillMatch = fp.match(/\.claude\/skills\/([^/]+)/);
          if (officialMatch) {
            source = 'Claude Official Plugin';
            sourceName = officialMatch[1];
          } else if (externalMatch) {
            source = 'External Plugin (MCP)';
            sourceName = externalMatch[1];
          } else if (ocSkillMatch) {
            source = 'OpenClaw Skill';
            sourceName = ocSkillMatch[1];
            skillName = ocSkillMatch[1];
          } else if (ocExtMatch) {
            source = 'OpenClaw Extension';
            sourceName = ocExtMatch[1];
          } else if (ocPluginMatch) {
            source = 'OpenClaw Plugin';
            sourceName = ocPluginMatch[1];
          } else if (ccSkillMatch) {
            source = 'Claude Skill';
            skillName = ccSkillMatch[1];
            sourceName = ccSkillMatch[1];
          } else if (fp.includes('.claude/')) {
            source = 'Claude Config';
          } else if (fp.includes('openclaw/')) {
            source = 'OpenClaw';
          }

          allFindings.push({
            ruleId: f.rule_id, title: f.title, description: f.description,
            severity: f.severity, category: f.category, confidence: f.confidence,
            tier: f.tier, filePath: f.location?.file_path, line: f.location?.start_line,
            snippet: f.location?.snippet, remediation: f.remediation?.description,
            cweId: f.cwe_id, owaspId: f.owasp_id, scanTarget: target,
            source, sourceName, skillName,
          });
        }
      }
    } catch (err) {
      console.warn(`[GuardClaw] agent-audit scan failed for ${target}:`, err.message);
      scanError = err.message;
    }
  }

  const bySeverity = {};
  const byCategory = {};
  for (const f of allFindings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
  }

  // Count directories helper
  const countDirs = (dir) => {
    try {
      if (fs.existsSync(dir)) {
        return fs.readdirSync(dir).filter(f => {
          try { return fs.statSync(path.join(dir, f)).isDirectory(); } catch { return false; }
        }).length;
      }
    } catch {}
    return 0;
  };

  const claudeDir = path.join(os.homedir(), '.claude');
  const pluginsDir = path.join(claudeDir, 'plugins', 'marketplaces', 'claude-plugins-official');
  let totalTools = 0;
  let totalSkills = 0;

  // Claude Code: official plugins + external plugins (MCP)
  totalTools += countDirs(path.join(pluginsDir, 'plugins'));
  totalTools += countDirs(path.join(pluginsDir, 'external_plugins'));
  totalSkills += countDirs(path.join(claudeDir, 'skills'));

  // OpenClaw: plugins + extensions + skills
  const ocDir = path.join(os.homedir(), 'openclaw');
  totalTools += countDirs(path.join(ocDir, 'plugins'));
  totalTools += countDirs(path.join(ocDir, 'extensions'));
  totalSkills += countDirs(path.join(ocDir, 'skills'));

  const dangerousToolNames = new Set();
  const dangerousSkillNames = new Set();
  for (const f of allFindings) {
    if (f.severity !== 'critical') continue; // Only critical findings count as risky
    const isToolSource = f.source === 'Claude Official Plugin' || f.source === 'External Plugin (MCP)'
      || f.source === 'OpenClaw Plugin' || f.source === 'OpenClaw Extension';
    const isSkillSource = f.source === 'OpenClaw Skill' || f.source === 'Claude Skill';
    if (f.sourceName && isToolSource) {
      dangerousToolNames.add(f.sourceName);
    } else if (f.sourceName && isSkillSource) {
      dangerousSkillNames.add(f.sourceName);
    }
  }

  // LLM review of findings (enrich with verdict)
  await llmReviewFindings(allFindings);

  const result = {
    ok: !scanError || allFindings.length > 0,
    findings: allFindings,
    summary: {
      total: allFindings.length, bySeverity, byCategory,
      totalTools, totalSkills,
      dangerousTools: dangerousToolNames.size,
      dangerousSkills: dangerousSkillNames.size,
      dangerousToolList: [...dangerousToolNames],
      dangerousSkillList: [...dangerousSkillNames],
      vulnerabilities: allFindings.filter(f => f.severity === 'critical' && f.llmVerdict !== 'FALSE_POSITIVE').length,
    },
    error: scanError,
  };

  cachedAuditResult = result;
  // Persist to disk
  const scanHash = computeScanHash(targets);
  saveAuditCache(scanHash, result);
  return result;
}

// GET scan progress
app.get('/api/audit/progress', (req, res) => {
  res.json(auditScanProgress);
});

// GET cached results (no re-scan) — includes configChanged flag if configs modified since last scan
app.get('/api/audit/results', (req, res) => {
  if (cachedAuditResult) {
    // Check if config files changed since last scan
    let configChanged = false;
    const cached = loadAuditCache();
    if (cached && cached.hash) {
      const scanTargets = [
        path.join(os.homedir(), '.claude'),
        path.join(os.homedir(), '.config', 'Claude'),
        path.join(os.homedir(), 'Library', 'Application Support', 'Claude'),
        path.join(os.homedir(), '.openclaw'),
      ];
      const currentHash = computeScanHash(scanTargets);
      configChanged = currentHash !== cached.hash;
    }
    res.json({ ...cachedAuditResult, configChanged });
  } else {
    res.json({ ok: false, findings: [], summary: null, error: 'No scan results yet' });
  }
});

// POST triggers a new scan (force=true to bypass cache)
let activeScanPromise = null;
app.post('/api/audit/scan', async (req, res) => {
  const { scanPath, force } = req.body;
  // Dedup: if a scan is already running, wait for it
  if (activeScanPromise) {
    console.log('[SecurityScan] Scan already in progress, waiting...');
    const result = await activeScanPromise;
    return res.json(result);
  }
  activeScanPromise = runAuditScan(scanPath, force === true);
  try {
    const result = await activeScanPromise;
    res.json(result);
  } finally {
    activeScanPromise = null;
  }
});

// Blocking configuration API
app.get('/api/blocking/status', (req, res) => {
  res.json({
    enabled: blockingEnabled,
    active: blockingEnabled, // reflects runtime toggle, not approvalHandler (which is fixed at startup)
    mode: approvalHandler ? approvalHandler.mode : (blockingEnabled ? 'plugin' : null),
    thresholds: approvalHandler ? approvalHandler.getStats().thresholds : null,
    whitelist: blockingConfig.whitelist || [],
    blacklist: blockingConfig.blacklist || []
  });
});

app.post('/api/blocking/toggle', (req, res) => {
  const { enabled } = req.body;
  
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  
  // Update in-memory state immediately — evaluate endpoint checks this at runtime
  blockingEnabled = enabled;
  console.log(`[GuardClaw] Blocking ${enabled ? 'enabled' : 'disabled (monitor mode)'}`);

  try {
    // Update .env file
    const envPath = path.join(getDataDir(), '.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

    if (envContent.includes('GUARDCLAW_BLOCKING_ENABLED=')) {
      envContent = envContent.replace(
        /GUARDCLAW_BLOCKING_ENABLED=.*/,
        `GUARDCLAW_BLOCKING_ENABLED=${enabled}`
      );
    } else {
      envContent += `\nGUARDCLAW_BLOCKING_ENABLED=${enabled}\n`;
    }
    
    fs.writeFileSync(envPath, envContent);
    
    // Update OpenClaw plugin configuration
    const openclawConfigPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    let needsGatewayRestart = false;
    
    if (fs.existsSync(openclawConfigPath)) {
      try {
        const openclawConfig = JSON.parse(fs.readFileSync(openclawConfigPath, 'utf8'));
        
        // Ensure plugin structure exists
        if (!openclawConfig.plugins) openclawConfig.plugins = {};
        if (!openclawConfig.plugins.entries) openclawConfig.plugins.entries = {};
        
        // Update guardclaw-interceptor plugin enabled state
        if (!openclawConfig.plugins.entries['guardclaw-interceptor']) {
          openclawConfig.plugins.entries['guardclaw-interceptor'] = {};
        }
        
        const wasEnabled = openclawConfig.plugins.entries['guardclaw-interceptor'].enabled;
        openclawConfig.plugins.entries['guardclaw-interceptor'].enabled = enabled;
        
        // Save updated config
        fs.writeFileSync(openclawConfigPath, JSON.stringify(openclawConfig, null, 2));
        
        if (wasEnabled !== enabled) {
          needsGatewayRestart = true;
        }
        
        console.log(`[GuardClaw] Updated OpenClaw plugin: ${enabled ? 'ENABLED' : 'DISABLED'}`);
      } catch (err) {
        console.error('[GuardClaw] Failed to update OpenClaw config:', err);
      }
    }
    
    const message = needsGatewayRestart 
      ? `Blocking ${enabled ? 'enabled' : 'disabled'}. ⚠️ OpenClaw Gateway restart required: openclaw gateway restart`
      : `Blocking setting updated to ${enabled ? 'ENABLED' : 'DISABLED'}.`;
    
    res.json({ 
      success: true, 
      enabled,
      needsGatewayRestart,
      message
    });
  } catch (error) {
    console.error('[GuardClaw] Toggle blocking error:', error);
    res.status(500).json({ 
      error: 'Failed to toggle blocking',
      message: error.message 
    });
  }
});

app.post('/api/blocking/whitelist', (req, res) => {
  const { pattern } = req.body;
  
  if (!pattern || typeof pattern !== 'string') {
    return res.status(400).json({ error: 'pattern must be a non-empty string' });
  }
  
  if (!blockingConfig.whitelist.includes(pattern)) {
    blockingConfig.whitelist.push(pattern);
    saveBlockingConfig();
  }
  
  res.json({ success: true, whitelist: blockingConfig.whitelist });
});

app.delete('/api/blocking/whitelist', (req, res) => {
  const { pattern } = req.body;
  
  blockingConfig.whitelist = blockingConfig.whitelist.filter(p => p !== pattern);
  saveBlockingConfig();
  
  res.json({ success: true, whitelist: blockingConfig.whitelist });
});

app.post('/api/blocking/blacklist', (req, res) => {
  const { pattern } = req.body;
  
  if (!pattern || typeof pattern !== 'string') {
    return res.status(400).json({ error: 'pattern must be a non-empty string' });
  }
  
  if (!blockingConfig.blacklist.includes(pattern)) {
    blockingConfig.blacklist.push(pattern);
    saveBlockingConfig();
  }
  
  res.json({ success: true, blacklist: blockingConfig.blacklist });
});

app.delete('/api/blocking/blacklist', (req, res) => {
  const { pattern } = req.body;
  
  blockingConfig.blacklist = blockingConfig.blacklist.filter(p => p !== pattern);
  saveBlockingConfig();
  
  res.json({ success: true, blacklist: blockingConfig.blacklist });
});

// ─── Event handling (shared across all backends) ─────────────────────────────

async function handleAgentEvent(event) {
  const eventType = event.event || event.type;

  // Handle exec approval requests (intercept before normal event processing)
  if (eventType === 'exec.approval.requested' && approvalHandler) {
    console.log('[GuardClaw] 🔔 Exec approval request received');
    await approvalHandler.handleApprovalRequest(event);
    return; // Don't process as normal event
  }

  // Track streaming events for detailed step analysis BEFORE filtering
  // This needs to see all delta events to build the complete picture
  const sessionKey = event.payload?.sessionKey || 'default';
  const session = streamingTracker.trackEvent(event);
  
  // Debug: log session keys
  if (eventType === 'chat' || eventType === 'agent') {
    console.log(`[GuardClaw] Event type: ${eventType}, sessionKey: ${sessionKey}, session has ${session.steps.length} steps`);
  }

  // Debug logging
  if (Math.random() < 0.05) {
    console.log('[GuardClaw] Sample event:', JSON.stringify(event, null, 2).substring(0, 500));
  }

  // Log tool events with full details
  if (event.payload?.stream === 'tool') {
    console.log('[GuardClaw] TOOL EVENT:', JSON.stringify({
      name: event.payload.data?.name,
      phase: event.payload.data?.phase,
      toolCallId: event.payload.data?.toolCallId,
      input: event.payload.data?.input,
      result: event.payload.data?.result,
      partialResult: event.payload.data?.partialResult,
      fullData: event.payload.data
    }, null, 2));
  }

  if (eventType && (eventType.startsWith('exec') || eventType === 'agent')) {
    console.log('[GuardClaw] Important event:', JSON.stringify(event, null, 2));
  } else {
    console.log('[GuardClaw] Event received:', eventType);
  }

  // Parse and enrich event
  const eventDetails = parseEventDetails(event);

  // Filter out noisy intermediate events for storage
  // BUT: streaming tracker already saw them above
  if (shouldSkipEvent(eventDetails)) {
    return; // Don't store delta events, but streaming tracker already captured them
  }

  const storedEvent = {
    id: generateId('oc'),
    timestamp: Date.now(),
    rawEvent: event,
    type: eventDetails.type,
    subType: eventDetails.subType,
    description: eventDetails.description,
    tool: eventDetails.tool,
    command: eventDetails.command,
    payload: event.payload || event,
    sessionKey: sessionKey,
    streamingSteps: [] // Will be populated below
  };

  // Get steps for this specific run (to avoid duplication between consecutive messages)
  const runId = event.payload?.runId;
  const recentSteps = runId 
    ? streamingTracker.getStepsForRun(sessionKey, runId)
    : streamingTracker.getSessionSteps(sessionKey, 20);
  
  if (recentSteps.length > 0) {
    console.log(`[GuardClaw] Found ${recentSteps.length} streaming steps for session ${sessionKey}, runId: ${runId || 'N/A'}`);
  }
  
  // Analyze recent steps (REAL-TIME: analyze on phase=start, not waiting for completion!)
  const analyzedSteps = [];
  for (const step of recentSteps) {
    // Skip assistant text output - we only want thinking and tool_use
    if (step.type === 'text') {
      continue;
    }
    
    // REAL-TIME ANALYSIS: Analyze tool_use steps immediately when they start
    // Don't wait for endTime - we want to catch dangerous operations BEFORE they complete
    const isToolUse = step.type === 'tool_use';
    const hasInput = step.parsedInput || step.metadata?.input || step.content;
    const shouldAnalyze = isToolUse && hasInput && !step.safeguard;
    
    if (shouldAnalyze) {
      const isStartPhase = step.phase === 'start' || !step.endTime;
      const statusEmoji = isStartPhase ? '⚡' : '🔍';
      const statusText = isStartPhase ? 'REAL-TIME' : 'POST-EXEC';

      // Check if plugin already evaluated this exact tool call — reuse result, skip LLM
      const stepParams = step.parsedInput || step.metadata?.input || {};
      const cachedAnalysis = getCachedEvaluation(sessionKey, step.toolName, stepParams);

      let stepAnalysis;
      if (cachedAnalysis) {
        stepAnalysis = cachedAnalysis;
        console.log(`[GuardClaw] ♻️  Cache hit for ${step.toolName} — reusing plugin evaluation (score=${cachedAnalysis.riskScore})`);
      } else {
        console.log(`[GuardClaw] ${statusEmoji} ${statusText} analyzing: ${step.toolName} (phase: ${step.phase})`);
        stepAnalysis = await analyzeStreamingStep(step);
      }
      step.safeguard = stepAnalysis;
      
      // Alert for high-risk operations (even if already executing)
      if (stepAnalysis.riskScore >= 7) {
        console.log(`[GuardClaw] 🚨 HIGH RISK detected: ${step.toolName}, risk=${stepAnalysis.riskScore}, ${isStartPhase ? 'STARTED' : 'COMPLETED'}`);
      } else {
        console.log(`[GuardClaw] ✅ Step analysis: risk=${stepAnalysis.riskScore}, backend=${stepAnalysis.backend}`);
      }
    }
    
    analyzedSteps.push(step);
  }

  const analyzedStepsMapped = buildAnalyzedSteps(analyzedSteps);
  
  console.log(`[GuardClaw] DEBUG: storedEvent type=${storedEvent.type}, eventDetails.type=${eventDetails.type}, recentSteps=${recentSteps.length}`);

  // Generate summary and include steps for events with tool calls
  const isLifecycleEnd = eventType === 'agent' && event.payload?.stream === 'lifecycle' && event.payload?.data?.phase === 'end';
  const isChatUpdate = eventDetails.type === 'chat-update' || eventDetails.type === 'agent-message';
  const toolSteps = analyzedStepsMapped.filter(s => s.type === 'tool_use' && s.toolName);

  // Always include streaming steps if available (no duplication since we filter by runId)
  storedEvent.streamingSteps = analyzedStepsMapped;
  
  // Generate summary for lifecycle:end or chat-update with tools
  const shouldGenerateSummary = (isLifecycleEnd || isChatUpdate) && toolSteps.length > 0;
  
  if (shouldGenerateSummary) {
    // Generate fallback summary immediately (fast)
    const toolNames = toolSteps.map(s => s.toolName).filter((v, i, a) => a.indexOf(v) === i);
    storedEvent.summary = `Used ${toolSteps.length} tool${toolSteps.length > 1 ? 's' : ''}: ${toolNames.join(', ')}`;
    storedEvent.summaryGenerating = true;  // Flag that we're generating
    console.log(`[GuardClaw] ⚡ Event has ${toolSteps.length} tools, using fallback summary, will generate AI summary in background...`);
    
    // Generate AI summary asynchronously (slow, don't block)
    const eventId = storedEvent.id;
    generateEventSummary(analyzedStepsMapped)
      .then(aiSummary => {
        console.log(`[GuardClaw] ✅ AI summary generated: ${aiSummary.substring(0, 100)}...`);
        eventStore.updateEvent(eventId, { 
          summary: aiSummary,
          summaryGenerating: false
        });
      })
      .catch(error => {
        console.error(`[GuardClaw] ❌ AI summary generation failed:`, error.message);
        eventStore.updateEvent(eventId, { 
          summaryGenerating: false 
        });
      });
  }

  
  // Create a summary event when lifecycle ends
  if (eventType === 'agent' && event.payload?.stream === 'lifecycle' && event.payload?.data?.phase === 'end') {
    const session = streamingTracker.getSession(sessionKey);
    const recentSteps = streamingTracker.getSessionSteps(sessionKey, 20);
    
    console.log(`[GuardClaw] lifecycle:end - recentSteps: ${recentSteps.length}, lastSummary: ${!!session.lastSummary}`);
    
    // Generate summary if we don't have one yet
    if (recentSteps.length > 0 && !session.lastSummary) {
      const toolStepsForSummary = recentSteps.filter(s => s.type === 'tool_use' && s.toolName);
      if (toolStepsForSummary.length > 0) {
        if (shouldGenerateSummary) {
          // Async summary generation already started in the shouldGenerateSummary block above.
          // Reuse the fallback summary (already set on storedEvent) to avoid a second LLM call.
          session.lastSummary = storedEvent.summary;
          console.log('[GuardClaw] ♻️  Reusing fallback summary for lifecycle:end card (async gen in progress)');
        } else {
          console.log('[GuardClaw] Generating summary at lifecycle:end');
          session.lastSummary = await generateEventSummary(recentSteps);
          console.log('[GuardClaw] Generated summary:', session.lastSummary);
        }
      }
    }
    
    if (recentSteps.length > 0 && session.lastSummary) {
      // Create a chat-message event with the summary
      const analyzedSteps = buildAnalyzedSteps(recentSteps);
      
      const summaryEvent = {
        id: generateId('oc-summary'),
        timestamp: Date.now(),
        rawEvent: event,
        type: 'chat-message',
        subType: 'summary',
        description: session.lastSummary,
        summary: session.lastSummary,
        tool: null,
        command: null,
        payload: event.payload || event,
        sessionKey: sessionKey,
        streamingSteps: analyzedSteps,
        safeguard: { riskScore: 1, category: 'safe', reasoning: 'Agent response', allowed: true, backend: 'classification' }
      };
      
      eventStore.addEvent(summaryEvent);
      console.log('[GuardClaw] Created summary event on lifecycle.end:', summaryEvent.id);
    }
  }

  // Analyze all tool calls with safeguard
  if (shouldAnalyzeEvent(eventDetails)) {
    // For tool-call events: Path 2 (streaming step loop above) already analyzed this step
    // via analyzeStreamingStep(). Reuse that result to avoid a second LLM call.
    const streamingAnalysis = eventDetails.type === 'tool-call'
      ? analyzedSteps.findLast(s => s.toolName === eventDetails.tool && s.safeguard)?.safeguard
      : null;

    if (streamingAnalysis) {
      storedEvent.safeguard = streamingAnalysis;
      console.log(`[GuardClaw] ♻️  Reusing streaming analysis for ${eventDetails.tool} (score=${streamingAnalysis.riskScore})`);
      eventStore.addEvent(storedEvent);
    } else {
      // Immediately push event with pending safeguard, then analyze async
      storedEvent.safeguard = { riskScore: null, category: 'pending', reasoning: 'Analyzing...', pending: true };
      eventStore.addEvent(storedEvent);

      // Async analysis — updates event in-place when done
      const action = extractAction(event, eventDetails);
      console.log('[GuardClaw] Analyzing:', action.type, action.summary);

      (async () => {
        try {
          let analysis;
          if (eventDetails.tool === 'message') {
            const recentChatContext = eventStore.getRecentEvents(200)
              .filter(e => e.safeguard?.isContext && e.description)
              .slice(-5)
              .map(e => e.description?.substring(0, 300))
              .filter(Boolean);
            analysis = await safeguardService.analyzeMessagePrivacy(action, recentChatContext);
            console.log('[GuardClaw] 🔒 Privacy analysis for message tool:', analysis.riskScore);
          } else {
            analysis = await safeguardService.analyzeAction(action);
          }

          if (analysis.riskScore >= 8) {
            console.warn('[GuardClaw] HIGH RISK:', action.summary);
          } else if (analysis.riskScore >= 4) {
            console.warn('[GuardClaw] MEDIUM RISK:', action.summary);
          } else {
            console.log('[GuardClaw] SAFE:', action.summary);
          }

          eventStore.updateEvent(storedEvent.id, { safeguard: analysis });
        } catch (error) {
          console.error('[GuardClaw] Safeguard analysis failed:', error);
          eventStore.updateEvent(storedEvent.id, { safeguard: { error: error.message, riskScore: 5, category: 'unknown' } });
        }
      })();
    }
  } else {
    storedEvent.safeguard = classifyNonExecEvent(eventDetails);
    eventStore.addEvent(storedEvent);
  }

  // Cleanup: Remove steps for this runId after storing to avoid duplication in next message
  const isCleanupNeeded = eventType === 'agent' && event.payload?.stream === 'lifecycle' && event.payload?.data?.phase === 'end';
  if (isCleanupNeeded && runId) {
    streamingTracker.clearStepsForRun(sessionKey, runId);
    console.log(`[GuardClaw] 🧹 Cleaned up steps for runId ${runId}`);
  }
}

// Generate a concise summary of an event based on its streaming steps
async function generateEventSummary(steps) {
  if (!steps || steps.length === 0) {
    return 'No activity';
  }

  // Extract tool usage
  const toolSteps = steps.filter(s => s.type === 'tool_use' && s.toolName);
  const thinkingSteps = steps.filter(s => s.type === 'thinking');
  const textSteps = steps.filter(s => s.type === 'text');

  // Debug: log step types
  console.log(`[GuardClaw] generateEventSummary: ${steps.length} total steps, ${toolSteps.length} tool, ${thinkingSteps.length} thinking, ${textSteps.length} text`);
  if (toolSteps.length > 0) {
    console.log(`[GuardClaw] Tool steps: ${toolSteps.map(s => s.toolName).join(', ')}`);
  }

  // Build a simple summary first (fallback)
  let fallbackSummary = '';
  if (toolSteps.length > 0) {
    const toolNames = toolSteps.map(s => s.toolName).filter((v, i, a) => a.indexOf(v) === i);
    fallbackSummary = `Used ${toolSteps.length} tool${toolSteps.length > 1 ? 's' : ''}: ${toolNames.join(', ')}`;
  } else if (textSteps.length > 0) {
    fallbackSummary = 'Generated text response';
  } else if (thinkingSteps.length > 0) {
    fallbackSummary = 'Reasoning step';
  } else {
    fallbackSummary = 'Processing...';
  }

  // Try to generate AI summary with local LLM
  try {
    // Build SIMPLIFIED context - just tool names and key actions (avoid model crashes)
    const sortedSteps = [...steps].sort((a, b) => a.timestamp - b.timestamp);
    const toolActions = [];
    
    sortedSteps.forEach(step => {
      if (step.type === 'tool_use' && step.toolName) {
        const tool = step.toolName;
        const input = step.metadata?.input || step.parsedInput || {};
        
        // Extract key info based on tool type
        if (tool === 'read') {
          toolActions.push(`read ${input.file_path || input.path || 'file'}`);
        } else if (tool === 'write') {
          toolActions.push(`write ${input.file_path || input.path || 'file'}`);
        } else if (tool === 'edit') {
          toolActions.push(`edit ${input.file_path || input.path || 'file'}`);
        } else if (tool === 'exec') {
          const cmd = input.command || '';
          const shortCmd = cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd;
          toolActions.push(`exec "${shortCmd}"`);
        } else if (tool === 'process') {
          toolActions.push(`process ${input.action || ''}`);
        } else {
          toolActions.push(tool);
        }
      }
    });

    const context = toolActions.join(', ');
    
    console.log('[GuardClaw] Summary context:', context);

    if (!safeguardService.llm) {
      console.error('[GuardClaw] ❌ LLM client not initialized!');
      return fallbackSummary;
    }

    // Use different prompts based on model
    const modelName = safeguardService.config.model || 'qwen/qwen3-1.7b';
    const isOSS = modelName.includes('oss') || modelName.includes('gpt');
    
    let messages, temperature, maxTokens;
    
    if (isOSS) {
      // GPT-OSS-20B: Can handle more sophisticated instructions
      messages = [
        { 
          role: 'system', 
          content: 'You are a helpful assistant that summarizes AI activities. Provide clear, detailed summaries in 2-3 sentences, explaining what was done and why.' 
        },
        { 
          role: 'user', 
          content: `Summarize what the AI did:\n\nActions: ${context}\n\nProvide a detailed 2-3 sentence summary:` 
        }
      ];
      temperature = 0.3;
      maxTokens = 200;
    } else {
      // Smaller models: Simple format with more detail
      messages = [
        { 
          role: 'user', 
          content: `What did the AI do?\n\nActions: ${context}\n\nAnswer in 2-3 sentences:` 
        }
      ];
      temperature = 0.2;
      maxTokens = 150;
    }

    console.log('[GuardClaw] 📝 Calling LLM for summary (model:', modelName, ')...');

    const response = await Promise.race([
      safeguardService.llm.chat.completions.create({
        model: modelName,
        messages,
        temperature,
        max_tokens: maxTokens
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('LLM timeout after 15s')), 15000)
      )
    ]);

    let summary = response?.choices?.[0]?.message?.content?.trim();
    
    // Aggressive cleanup for small models (especially qwen3 with <think> tags)
    if (summary) {
      // Strategy: Extract content BEFORE <think>, or take first meaningful sentence
      
      // Case 1: Content starts with <think> - extract nothing, will use fallback
      if (summary.startsWith('<think>')) {
        console.log('[GuardClaw] ⚠️ Response starts with <think>, using fallback');
        summary = null;
      } else {
        // Case 2: Content before <think> exists - extract it
        const thinkIndex = summary.search(/<think>/i);
        if (thinkIndex > 0) {
          summary = summary.substring(0, thinkIndex).trim();
          console.log('[GuardClaw] 🔧 Removed <think> section');
        }
        
        // Remove any remaining think tags
        summary = summary.replace(/<\/?think>/gi, '');
        
        // Remove meta prefixes
        summary = summary.replace(/^(Summary:|Answer:|Response:|Describe:|Okay,?\s+|Let me\s+|First,?\s+)/i, '');
        
        // Take only first sentence/line
        summary = summary.split(/\n/)[0];
        summary = summary.split(/\.\s+[A-Z]/)[0]; // Stop at sentence boundary
        
        // Remove trailing thinking phrases
        summary = summary.replace(/\s+(Okay|Let me|First|The user|I need|Let's).*$/i, '');
        
        summary = summary.trim();
        
        // If summary is too short or empty after cleanup, reject it
        if (!summary || summary.length < 8) {
          console.log('[GuardClaw] ⚠️ Summary too short after cleanup:', summary);
          summary = null;
        }
        
        // If starts with lowercase verb, prepend "The AI"
        if (summary && /^[a-z]/.test(summary)) {
          summary = 'The AI ' + summary;
        }
        
        // Ensure it ends with period
        if (summary && !summary.match(/[.!?]$/)) {
          summary = summary + '.';
        }
      }
    }
    
    if (summary && summary.length > 10) {
      console.log('[GuardClaw] ✅ LLM generated summary:', summary);
      return summary;
    } else {
      console.warn('[GuardClaw] ⚠️ LLM returned empty/invalid summary, using fallback');
    }
  } catch (error) {
    const errMsg = error.message || String(error);
    console.error('[GuardClaw] ❌ LLM call failed:', errMsg);
    
    if (errMsg.includes('crashed') || errMsg.includes('timeout')) {
      console.error('[GuardClaw] Model may need restart in LM Studio');
    }
  }

  console.log('[GuardClaw] 💤 Using fallback:', fallbackSummary);
  return fallbackSummary;
}

// Analyze a streaming step (thinking, tool_use, exec)
async function analyzeStreamingStep(step) {
  try {
    if (step.type === 'thinking') {
      // Analyze thinking content for potential issues
      const thinkingText = step.content || '';
      if (thinkingText.length < 20) {
        return {
          riskScore: 0,
          category: 'safe',
          reasoning: 'Brief thinking step',
          allowed: true,
          warnings: [],
          backend: 'classification'
        };
      }
      
      // Look for sensitive patterns in thinking
      const sensitivePatterns = [
        /password|passwd|pwd.*[=:]/i,
        /api[_-]?key.*[=:]/i,
        /secret|token.*[=:]/i,
        /credit.*card/i
      ];
      
      for (const pattern of sensitivePatterns) {
        if (pattern.test(thinkingText)) {
          return {
            riskScore: 6,
            category: 'sensitive-data',
            reasoning: 'Thinking contains potentially sensitive information',
            allowed: true,
            warnings: ['Sensitive data in reasoning'],
            backend: 'pattern'
          };
        }
      }
      
      return {
        riskScore: 0,
        category: 'safe',
        reasoning: 'Normal reasoning process',
        allowed: true,
        warnings: [],
        backend: 'classification'
      };
    } else if (step.type === 'tool_use') {
      // Analyze tool call — pass full parsedInput so write/edit can judge content
      const input = step.parsedInput || step.metadata?.input || {};
      const action = {
        type: step.toolName || 'unknown',
        tool: step.toolName,
        summary: `${step.toolName}: ${JSON.stringify(input).substring(0, 120)}`,
        parsedInput: input,  // full input — safeguard.js uses this for write/edit
        metadata: step.metadata
      };
      return await safeguardService.analyzeAction(action);
    } else if (step.type === 'exec') {
      // Analyze exec command
      return await safeguardService.analyzeCommand(step.command);
    }
    
    return {
      riskScore: 0,
      category: 'safe',
      reasoning: 'Unknown step type',
      allowed: true,
      warnings: [],
      backend: 'classification'
    };
  } catch (error) {
    console.error('[GuardClaw] Step analysis failed:', error);
    return {
      riskScore: 5,
      category: 'unknown',
      reasoning: `Analysis error: ${error.message}`,
      allowed: true,
      warnings: [],
      backend: 'error'
    };
  }
}

// Register event handler on ALL active clients
for (const { client } of activeClients) {
  client.onEvent(handleAgentEvent);
}

// ─── Start server ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('');
  console.log('🛡️  GuardClaw - AI Agent Safety Monitor');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 Server:    http://localhost:${PORT}`);
  console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`🔧 API:       http://localhost:${PORT}/api/status`);
  console.log(`🔌 Backend:   ${BACKEND} (${activeClients.map(c => c.name).join(', ')})`);
  console.log('');

  if (process.env.AUTO_CONNECT !== 'false') {
    // Connect all active backends
    const connectPromises = activeClients.map(({ client, name }) => {
      const url = name === 'openclaw'
        ? (process.env.OPENCLAW_URL || process.env.CLAWDBOT_URL || 'ws://127.0.0.1:18789')
        : (process.env.NANOBOT_URL || 'ws://127.0.0.1:18790');
      console.log(`🔌 Connecting to ${name}... (${url})`);

      return client.connect()
        .then(() => {
          console.log(`✅ ${name} connected`);
          return { name, connected: true };
        })
        .catch((err) => {
          console.log(`⚠️  ${name} connection failed: ${err.message}`);
          if (client.autoReconnect) {
            console.log(`   Auto-reconnect enabled for ${name}`);
          }
          return { name, connected: false };
        });
    });

    Promise.allSettled(connectPromises).then(async (results) => {
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`🛡️  Safeguard: ${safeguardService.backend.toUpperCase()}`);

      // Test LLM backend
      console.log('');
      console.log('🔍 Testing LLM backend connection...');
      const llmStatus = await safeguardService.testConnection();

      if (llmStatus.connected) {
        if (llmStatus.canInfer) {
          console.log(`✅ ${llmStatus.backend.toUpperCase()}: ${llmStatus.message}`);
        } else {
          console.log(`⚠️  ${llmStatus.backend.toUpperCase()}: ${llmStatus.message}`);
        }
        if (llmStatus.activeModel) {
          console.log(`   Active Model: ${llmStatus.activeModel}`);
        }
        if (llmStatus.modelNames && llmStatus.modelNames.length > 0) {
          console.log(`   Available Models: ${llmStatus.modelNames.join(', ')}`);
        }
      } else {
        console.log(`❌ ${llmStatus.backend.toUpperCase()}: ${llmStatus.message}`);
        if (llmStatus.backend === 'lmstudio') {
          console.log('   GuardClaw will use pattern-matching fallback until LM Studio connects.');
        }
      }

      // Fetch OpenClaw gateway info if connected
      if (openclawClient && openclawClient.connected) {
        console.log('');
        console.log('🔍 Fetching OpenClaw Gateway information...');
        try {
          const sessionsResponse = await openclawClient.request('sessions.list', {
            activeMinutes: 60,
            limit: 10
          });

          const sessions = sessionsResponse.sessions || sessionsResponse || [];
          console.log(`✅ Gateway Status:`);
          console.log(`   Active Sessions: ${sessions.length}`);

          if (sessions.length > 0) {
            console.log(`   Agents:`);
            for (const session of sessions.slice(0, 5)) {
              const label = session.label || session.key || 'unknown';
              const agentId = session.agentId || 'default';
              const lastActive = session.lastActiveAt
                ? new Date(session.lastActiveAt).toLocaleTimeString()
                : 'unknown';
              console.log(`      - ${label} (${agentId}) - last active: ${lastActive}`);
            }
            if (sessions.length > 5) {
              console.log(`      ... and ${sessions.length - 5} more`);
            }
          }
        } catch (error) {
          console.log(`⚠️  Could not fetch Gateway info: ${error.message}`);
        }
      }

      // Start session poller (OpenClaw only)
      if (sessionPoller && openclawClient && openclawClient.connected) {
        const pollInterval = parseInt(process.env.POLL_INTERVAL) || 30000;
        sessionPoller.start(pollInterval);
      }

      console.log('');
      console.log('🎯 GuardClaw is now monitoring your agents!');
      console.log('');

      // Load cached audit results on startup (no auto-scan)
      const cached = loadAuditCache();
      if (cached && cached.result) {
        cachedAuditResult = cached.result;
        const s = cached.result.summary;
        console.log(`Loaded cached scan: ${s.totalTools} tools, ${s.totalSkills} skills — ${s.dangerousTools} risky tools, ${s.dangerousSkills} risky skills`);
      } else {
        console.log('No cached scan results. Click scan in Bar to run.');
      }

      // ─── Periodic cleanup (every 5 minutes) ─────────────────────────────
      setInterval(() => {
        // 1. Purge expired evaluation cache entries
        let evicted = 0;
        const now = Date.now();
        for (const [key, entry] of evaluationCache) {
          if (now > entry.expiresAt) { evaluationCache.delete(key); evicted++; }
        }

        // 2. Clean up old streaming tracker sessions (>1 hour)
        streamingTracker.cleanup(3600000);

        // 3. Clean up stale toolHistoryStore sessions (>2 hours since last entry)
        const histCutoff = now - 7200000;
        let histEvicted = 0;
        for (const [sessionKey, history] of toolHistoryStore) {
          const lastEntry = history[history.length - 1];
          if (!lastEntry || lastEntry.timestamp < histCutoff) {
            toolHistoryStore.delete(sessionKey);
            histEvicted++;
          }
        }

        // 4. Clean up stale CC transcript caches (>2 hours)
        // ccTranscriptPaths and ccLastReadLine track intermediate text extraction
        // Keys are raw session_id; toolHistoryStore uses `claude-code:${session_id}`
        let ccEvicted = 0;
        for (const sessionId of ccTranscriptPaths.keys()) {
          const histKey = `claude-code:${sessionId}`;
          if (!toolHistoryStore.has(histKey)) {
            ccTranscriptPaths.delete(sessionId);
            ccLastReadLine.delete(sessionId);
            ccEvicted++;
          }
        }
        // Also clean orphan ccLastReadLine entries
        for (const sessionId of ccLastReadLine.keys()) {
          if (!ccTranscriptPaths.has(sessionId)) {
            ccLastReadLine.delete(sessionId);
          }
        }

        // 5. Infer denials from timed-out pending asks (no PostToolUse received)
        let denyInferred = 0;
        for (const [key, ask] of ccPendingAsks) {
          if (now - ask.timestamp > PENDING_ASK_TIMEOUT_MS) {
            ccPendingAsks.delete(key);
            memoryStore.recordDecision(ask.toolName, ask.displayInput, ask.riskScore, 'deny', ask.sessionKey);
            console.log(`[GuardClaw] 🧠 Memory: inferred DENIAL (timeout) → ${ask.toolName}: ${ask.commandStr.slice(0, 80)}`);
            denyInferred++;
          }
        }

        if (evicted || histEvicted || ccEvicted || denyInferred) {
          console.log(`[GuardClaw] 🧹 Cleanup: evalCache=${evicted}, toolHistory=${histEvicted}, ccTranscript=${ccEvicted}, denyInferred=${denyInferred}`);
        }
      }, 300_000);

      // ─── Memory DB cleanup (every hour — heavier than in-memory cleanup) ───
      setInterval(() => {
        try { memoryStore.cleanup(90); } catch (e) { console.error('[GuardClaw] Memory cleanup error:', e.message); }
      }, 3600_000);
    });
  } else {
    console.log('⏸️  Auto-connect disabled (AUTO_CONNECT=false)');
    console.log('   Use POST /api/connect to connect manually');
    console.log('');
  }
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('');
  console.log('🛑 Shutting down GuardClaw...');
  console.log('');

  if (sessionPoller) sessionPoller.stop();
  memoryStore.shutdown();
  for (const { client } of activeClients) {
    client.disconnect();
  }

  console.log('✅ Shutdown complete');
  console.log('');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('');
  console.log('🛑 Received SIGTERM, shutting down...');
  console.log('');

  if (sessionPoller) sessionPoller.stop();
  for (const { client } of activeClients) {
    client.disconnect();
  }

  process.exit(0);
});
