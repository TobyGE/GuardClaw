#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';
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
import { installTracker } from './install-tracker.js';
import { streamingTracker } from './streaming-tracker.js';
import { MemoryStore } from './memory.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

// Blocking config (whitelist/blacklist)
const BLOCKING_CONFIG_PATH = path.join(process.cwd(), 'blocking-config.json');
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
app.use(express.static('client/dist', { maxAge: 0, etag: false }));

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
const lastCCPromptTime = new Map(); // sessionKey → epoch ms when UserPromptSubmit fired
const lastCCPromptText = new Map();  // sessionKey → last user prompt text (for LLM context)
const ccTranscriptPaths = new Map(); // session_id → transcript_path (cached from Stop hook)
const ccLastReadLine = new Map();    // session_id → last line number processed for intermediate text
const EVAL_CACHE_TTL_MS = 60_000;

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
  const backends = {};
  for (const { client, name } of activeClients) {
    backends[name] = client.getConnectionStats();
  }
  // Claude Code is always "connected" — it's an HTTP hook, no WebSocket needed
  backends['claude-code'] = { connected: true, label: 'Claude Code', type: 'http-hook' };

  // Connected if ANY backend is connected
  const anyConnected = activeClients.some(({ client }) => client.connected);

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

  // Per-backend reconnect warnings
  for (const [name, stats] of Object.entries(backends)) {
    if (stats.reconnectAttempts > 0) {
      warnings.push({
        level: 'warning',
        message: `${name} connection unstable (${stats.reconnectAttempts} reconnect attempts)`,
        suggestion: 'Check network connectivity'
      });
    }
  }

  if (llmStatus && !llmStatus.connected && llmStatus.backend !== 'fallback') {
    warnings.push({
      level: 'error',
      message: `${llmStatus.backend.toUpperCase()} not connected`,
      suggestion: llmStatus.backend === 'lmstudio'
        ? 'Start LM Studio and load a model, or set SAFEGUARD_BACKEND=fallback'
        : llmStatus.backend === 'ollama'
        ? 'Start Ollama service, or set SAFEGUARD_BACKEND=fallback'
        : 'Check API credentials'
    });
  }

  if (llmStatus && llmStatus.connected && llmStatus.models === 0 && llmStatus.backend === 'lmstudio') {
    warnings.push({
      level: 'warning',
      message: 'LM Studio connected but no models loaded',
      suggestion: 'Load a model in LM Studio for AI-powered analysis'
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
  const allEvents = eventStore.getRecentEvents(10000);
  const sessionMap = new Map(); // sessionKey → { key, label, parent, eventCount, lastEventTime, firstEventTime }

  for (const event of allEvents) {
    // Normalize legacy session keys to the canonical format
    const key = (!event.sessionKey || event.sessionKey === 'default') ? 'agent:main:main' : event.sessionKey;
    if (!key) continue;
    const existing = sessionMap.get(key);
    if (existing) {
      existing.eventCount++;
      existing.lastEventTime = Math.max(existing.lastEventTime, event.timestamp || 0);
    } else {
      // Derive parent and label from session key
      // Formats: agent:main:main, agent:main:telegram:direct:123, agent:main:subagent:<uuid>
      //          claude-code:<session-uuid>
      const isCCSession = key.startsWith('claude-code:');
      const isSubagent = !isCCSession && key.includes(':subagent:');
      const parentKey = isSubagent ? key.replace(/:subagent:[^:]+$/, ':main') : null;
      const shortId = isSubagent ? key.split(':subagent:')[1]?.substring(0, 8) : null;

      let label;
      if (isCCSession) {
        label = 'Claude Code';
      } else if (isSubagent) {
        label = `Sub-agent ${shortId}`;
      } else {
        // Extract channel from key: agent:main:<channel>:... or agent:main:main
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

      sessionMap.set(key, {
        key,
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

  // Mark sessions as inactive/hidden based on idle time
  // Sub-agents: inactive after 2min, hidden after 24h
  // Non-primary main sessions: inactive after 10min, hidden after 7 days
  const now = Date.now();
  const hiddenKeys = [];
  const mainSessions = Array.from(sessionMap.values()).filter(s => !s.isSubagent);
  const primaryMainKey = mainSessions.length > 0
    ? mainSessions.sort((a, b) => b.eventCount - a.eventCount)[0].key
    : null;

  for (const s of sessionMap.values()) {
    const idleMs = now - s.lastEventTime;
    if (s.isSubagent) {
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
  const limit = Math.min(parseInt(req.query.limit) || 100, 10000);
  const filter = req.query.filter || null;   // 'safe', 'warning', 'blocked'
  const sessionFilter = req.query.session || null;

  // Filtering pushed down to SQLite for performance
  let events = eventStore.getFilteredEvents(limit, filter, sessionFilter);

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

    if (toolName === 'exec') {
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
    default: return toolInput;
  }
}

// Emit any new assistant text blocks from the Claude Code transcript as claude-code-text events.
// Called in PreToolUse (captures text before each tool call) and Stop (captures remaining text).
function emitIntermediateText(session_id) {
  const transcriptPath = ccTranscriptPaths.get(session_id);
  if (!transcriptPath) return;
  const sessionKey = session_id ? `claude-code:${session_id}` : 'claude-code:default';
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

app.post('/api/hooks/pre-tool-use', rateLimit(60_000, 60), async (req, res) => {
  console.log(`[GuardClaw] 🔔 pre-tool-use received:`, JSON.stringify(req.body).slice(0, 500));
  const { tool_name, tool_input, session_id } = req.body;
  if (!tool_name) return res.json({});

  const gcToolName = mapClaudeCodeTool(tool_name);
  const gcParams = mapClaudeCodeParams(tool_name, tool_input);
  const sessionKey = session_id ? `claude-code:${session_id}` : 'claude-code:default';

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
        const memMsg = `⛨ GuardClaw: auto-approved by memory (pattern: ${memoryHint.pattern})`;
        console.log(`[GuardClaw] 🧠 ${memMsg}`);
        return res.json({
          systemMessage: memMsg,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: memMsg,
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
    if (gcToolName === 'exec') {
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
        case 'write': return (params.file_path || params.path || '?') + '\n' + (params.content || '');
        case 'edit': return (params.file_path || params.path || '?') + '\n' + (params.old_string || params.oldText || '').slice(0, 300);
        case 'read': return params.file_path || params.path || JSON.stringify(params);
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
      // Enrich reasoning with task context for rule-based verdicts
      let reasoning = analysis.reasoning || '';
      if (taskContext?.userPrompt && analysis.backend === 'rules') {
        reasoning += ` | Task: "${taskContext.userPrompt.slice(0, 100)}"`;
      }
      const reason = reasoning ? ` — ${reasoning}` : '';
      const msg = `⛨ GuardClaw: auto-approved (score: ${analysis.riskScore})${reason}`;
      console.log(`[GuardClaw] ${msg}`);
      return res.json({
        systemMessage: msg,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: msg,
        },
      });
    }

    // High risk → ask user in terminal if blocking enabled, otherwise pass-through
    if (blockingEnabled) {
      const askMsg = `⛨ GuardClaw: high-risk action detected (score: ${analysis.riskScore}) — ${analysis.reasoning || analysis.category}`;
      console.log(`[GuardClaw] ❓ Claude Code asking user: ${tool_name} (score ${analysis.riskScore})`);
      return res.json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: askMsg,
        },
      });
    }

    console.log(`[GuardClaw] ⛨ Claude Code pass-through: ${tool_name} (score ${analysis.riskScore}) — user will decide`);
    return res.json({});

  } catch (error) {
    console.error('[GuardClaw] Claude Code hook error:', error.message);
    // On error, always pass-through — let Claude Code handle normally
    return res.json({});
  }
});

// Approval management endpoints
app.get('/api/approvals/pending', (req, res) => {
  const pending = [];
  for (const [id, entry] of pendingApprovals) {
    pending.push({
      id, toolName: entry.toolName, originalToolName: entry.originalToolName,
      displayInput: entry.displayInput, riskScore: entry.riskScore,
      reason: entry.reason, createdAt: entry.createdAt,
      elapsed: Math.round((Date.now() - entry.createdAt) / 1000),
    });
  }
  res.json({ pending });
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
  const { tool_name, tool_input, tool_output, session_id } = req.body;
  if (!tool_name) return res.json({});

  const gcToolName = mapClaudeCodeTool(tool_name);
  const gcParams = mapClaudeCodeParams(tool_name, tool_input);
  const sessionKey = session_id ? `claude-code:${session_id}` : 'claude-code:default';

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
  const { session_id, prompt } = req.body;
  if (!prompt) return res.json({});
  const sessionKey = session_id ? `claude-code:${session_id}` : 'claude-code:default';
  const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

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

  const promptId = `cc-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  eventStore.addEvent({
    id: promptId,
    type: 'claude-code-prompt',
    sessionKey,
    text: promptText,
    injectionDetected,
    timestamp: Date.now(),
  });
  lastCCPromptId.set(sessionKey, promptId);   // track for stop-hook reply linking
  lastCCPromptTime.set(sessionKey, Date.now()); // timestamp when prompt was submitted
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
  lastCCPromptTime.delete(sessionKey);

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
    const idempotencyKey = `guardclaw-retry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
};
app.use(configRoutes(routeDeps));
app.use(benchmarkRoutes(routeDeps));

// ─── Approval APIs ───────────────────────────────────────────────────────────

app.get('/api/approvals/pending', (req, res) => {
  if (!approvalHandler) {
    return res.status(503).json({ error: 'Approval handler not available' });
  }
  const pending = approvalHandler.getPendingApprovals();
  res.json({ pending, count: pending.length });
});

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
    const envPath = path.join(process.cwd(), '.env');
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
    const envPath = path.join(process.cwd(), '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    
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
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
    
    // Include all steps except text (analyzed or not) with full metadata
    analyzedSteps.push({
      id: step.id,
      type: step.type,
      timestamp: step.timestamp,
      duration: step.duration,
      content: step.content?.substring(0, 200) || '', // Truncate for display
      toolName: step.toolName,
      command: step.command || formatStepCommand(step),
      metadata: step.metadata, // Include full metadata for frontend
      safeguard: step.safeguard || null
    });
  }
  
  // Sort by timestamp (oldest first) for chronological display
  analyzedSteps.sort((a, b) => a.timestamp - b.timestamp);
  
  console.log(`[GuardClaw] DEBUG: storedEvent type=${storedEvent.type}, eventDetails.type=${eventDetails.type}, recentSteps=${recentSteps.length}`);

  // Generate summary and include steps for events with tool calls
  const isLifecycleEnd = eventType === 'agent' && event.payload?.stream === 'lifecycle' && event.payload?.data?.phase === 'end';
  const isChatUpdate = eventDetails.type === 'chat-update' || eventDetails.type === 'agent-message';
  const toolSteps = analyzedSteps.filter(s => s.type === 'tool_use' && s.toolName);
  
  // Always include streaming steps if available (no duplication since we filter by runId)
  storedEvent.streamingSteps = analyzedSteps;
  
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
    generateEventSummary(analyzedSteps)
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
      const analyzedSteps = recentSteps.map(step => ({
        id: step.id,
        type: step.type,
        timestamp: step.timestamp,
        duration: step.duration,
        content: step.content?.substring(0, 200) || '',
        toolName: step.toolName,
        command: step.command,
        metadata: step.metadata,
        safeguard: step.safeguard || null
      }));
      analyzedSteps.sort((a, b) => a.timestamp - b.timestamp);
      
      const summaryEvent = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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

        if (evicted || histEvicted || ccEvicted) {
          console.log(`[GuardClaw] 🧹 Cleanup: evalCache=${evicted}, toolHistory=${histEvicted}, ccTranscript=${ccEvicted} sessions evicted`);
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
