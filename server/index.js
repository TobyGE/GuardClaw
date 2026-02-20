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
import { installTracker } from './install-tracker.js';
import { streamingTracker } from './streaming-tracker.js';

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
app.use(express.static('client/dist'));

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
        logger.info(`OpenClaw reconnecting... (attempt ${attempt}, delay ${Math.round(delay/1000)}s)`);
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
        logger.info(`Nanobot reconnecting... (attempt ${attempt}, delay ${Math.round(delay/1000)}s)`);
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
const blockingEnabled = process.env.GUARDCLAW_BLOCKING_ENABLED === 'true';
const approvalHandler = (openclawClient && blockingEnabled)
  ? new ApprovalHandler(openclawClient, safeguardService, eventStore, { blockingConfig })
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

  req.on('close', () => {
    eventStore.removeListener(listener);
  });
});

// ─── API endpoints ───────────────────────────────────────────────────────────

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
      active: !!approvalHandler,
      mode: approvalHandler ? approvalHandler.mode : null
    },

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

app.get('/api/events/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const filter = req.query.filter; // 'safe', 'warning', 'blocked', or null for all
  
  let events = eventStore.getRecentEvents(Math.min(limit, 10000)); // Max 10k
  
  // Apply filter if specified
  if (filter) {
    events = events.filter(event => {
      if (!event.safeguard || event.safeguard.riskScore === undefined) {
        return filter === 'safe'; // Events without safeguard are considered safe
      }
      
      const riskScore = event.safeguard.riskScore;
      
      if (filter === 'safe') {
        return riskScore <= 3;
      } else if (filter === 'warning') {
        return riskScore > 3 && riskScore <= 7;
      } else if (filter === 'blocked') {
        return riskScore > 7;
      }
      return true;
    });
  }
  
  res.json({ 
    events: events.reverse(), // Reverse so newest first
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
      summary: `${toolName}: ${JSON.stringify(params || {})}`,
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

// ─── Pre-Execution Risk Evaluation API (uses LM Studio) ──────────────────────

app.post('/api/evaluate', async (req, res) => {
  const { toolName, params } = req.body;
  
  if (!toolName) {
    return res.status(400).json({ error: 'toolName is required' });
  }
  
  try {
    let analysis;
    
    if (toolName === 'exec') {
      // For exec, analyze the command with full LLM analysis
      const cmd = params.command || '';
      analysis = await safeguardService.analyzeCommand(cmd);
    } else {
      // For other tools, analyze the action
      analysis = await safeguardService.analyzeToolAction({
        tool: toolName,
        summary: JSON.stringify(params),
        ...params
      });
    }
    
    // Return evaluation result
    res.json({
      action: analysis.riskScore >= 8 ? 'ask' : 'allow',
      risk: analysis.riskScore,
      reason: analysis.reasoning || analysis.category,
      details: analysis.warnings?.join('; ') || analysis.reasoning || '',
      backend: analysis.backend
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

// ─── Config Management APIs ──────────────────────────────────────────────────

app.post('/api/config/token', async (req, res) => {
  const { token } = req.body;
  
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Invalid token' });
  }
  
  try {
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    
    // Read existing .env file
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    // Update or add OPENCLAW_TOKEN
    const tokenRegex = /^OPENCLAW_TOKEN=.*/m;
    if (tokenRegex.test(envContent)) {
      envContent = envContent.replace(tokenRegex, `OPENCLAW_TOKEN=${token}`);
    } else {
      envContent += `\nOPENCLAW_TOKEN=${token}\n`;
    }
    
    // Write back to file
    fs.writeFileSync(envPath, envContent, 'utf8');
    
    // Update runtime environment
    process.env.OPENCLAW_TOKEN = token;
    
    // Reconnect OpenClaw client if it exists
    if (openclawClient) {
      openclawClient.token = token;
      console.log('[GuardClaw] Token updated, reconnecting...');
      openclawClient.disconnect();
      setTimeout(() => {
        openclawClient.connect().catch(err => {
          console.error('[GuardClaw] Reconnect failed:', err);
        });
      }, 1000);
    }
    
    res.json({ success: true, message: 'Token saved and reconnecting' });
  } catch (error) {
    console.error('[GuardClaw] Failed to save token:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/config/detect-token', async (req, res) => {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    
    if (!fs.existsSync(configPath)) {
      return res.status(404).json({ error: 'OpenClaw config not found' });
    }
    
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configContent);
    const token = config?.gateway?.auth?.token;
    
    if (!token) {
      return res.status(404).json({ error: 'Token not found in OpenClaw config' });
    }
    
    res.json({ token, source: configPath });
  } catch (error) {
    console.error('[GuardClaw] Failed to detect token:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/config/llm', async (req, res) => {
  const { backend, lmstudioUrl, lmstudioModel, ollamaUrl, ollamaModel } = req.body;
  
  if (!backend || !['lmstudio', 'ollama', 'anthropic'].includes(backend)) {
    return res.status(400).json({ error: 'Invalid backend' });
  }
  
  try {
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    
    // Read existing .env file
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    // Update or add config values
    const updates = {
      SAFEGUARD_BACKEND: backend,
      LMSTUDIO_URL: lmstudioUrl,
      LMSTUDIO_MODEL: lmstudioModel,
      OLLAMA_URL: ollamaUrl,
      OLLAMA_MODEL: ollamaModel
    };
    
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        const regex = new RegExp(`^${key}=.*`, 'm');
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}=${value}`);
        } else {
          envContent += `\n${key}=${value}\n`;
        }
      }
    }
    
    // Write back to file
    fs.writeFileSync(envPath, envContent, 'utf8');
    
    // Update runtime environment
    process.env.SAFEGUARD_BACKEND = backend;
    if (lmstudioUrl) process.env.LMSTUDIO_URL = lmstudioUrl;
    if (lmstudioModel) process.env.LMSTUDIO_MODEL = lmstudioModel;
    if (ollamaUrl) process.env.OLLAMA_URL = ollamaUrl;
    if (ollamaModel) process.env.OLLAMA_MODEL = ollamaModel;
    
    // Recreate safeguard service with new config
    const newSafeguard = new SafeguardService(
      process.env.ANTHROPIC_API_KEY,
      backend,
      {
        lmstudioUrl,
        lmstudioModel,
        ollamaUrl,
        ollamaModel
      }
    );
    
    // Test connection
    const testResult = await newSafeguard.testConnection();
    
    if (testResult.connected) {
      // Replace global safeguard service
      Object.assign(safeguardService, newSafeguard);
      console.log('[GuardClaw] LLM config updated and applied');
      
      res.json({ 
        success: true, 
        message: 'LLM config saved and applied',
        testResult
      });
    } else {
      res.status(500).json({ 
        error: 'Config saved but connection failed',
        testResult
      });
    }
  } catch (error) {
    console.error('[GuardClaw] Failed to save LLM config:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/config/llm/test', async (req, res) => {
  const { backend, lmstudioUrl, lmstudioModel, ollamaUrl, ollamaModel } = req.body;
  
  if (!backend || !['lmstudio', 'ollama', 'anthropic'].includes(backend)) {
    return res.status(400).json({ error: 'Invalid backend' });
  }
  
  try {
    // Create temporary safeguard service to test
    const testSafeguard = new SafeguardService(
      process.env.ANTHROPIC_API_KEY,
      backend,
      {
        lmstudioUrl,
        lmstudioModel,
        ollamaUrl,
        ollamaModel
      }
    );
    
    const result = await testSafeguard.testConnection();
    res.json(result);
  } catch (error) {
    console.error('[GuardClaw] LLM connection test failed:', error);
    res.status(500).json({ 
      connected: false,
      error: error.message,
      message: `Test failed: ${error.message}`
    });
  }
});

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

// Blocking configuration API
app.get('/api/blocking/status', (req, res) => {
  res.json({
    enabled: blockingEnabled,
    active: !!approvalHandler,
    mode: approvalHandler ? approvalHandler.mode : null,
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
  
  res.json({ 
    success: true, 
    enabled,
    message: 'Blocking setting updated. Please restart GuardClaw for changes to take effect.'
  });
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
      
      console.log(`[GuardClaw] ${statusEmoji} ${statusText} analyzing: ${step.toolName} (phase: ${step.phase})`);
      const stepAnalysis = await analyzeStreamingStep(step);
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
      command: step.command,
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
      const toolSteps = recentSteps.filter(s => s.type === 'tool_use' && s.toolName);
      if (toolSteps.length > 0) {
        console.log('[GuardClaw] Generating summary at lifecycle:end');
        session.lastSummary = await generateEventSummary(recentSteps);
        console.log('[GuardClaw] Generated summary:', session.lastSummary);
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
    const action = extractAction(event, eventDetails);
    console.log('[GuardClaw] Analyzing:', action.type, action.summary);

    try {
      const analysis = await safeguardService.analyzeAction(action);
      storedEvent.safeguard = analysis;

      if (analysis.riskScore >= 8) {
        console.warn('[GuardClaw] HIGH RISK:', action.summary);
      } else if (analysis.riskScore >= 4) {
        console.warn('[GuardClaw] MEDIUM RISK:', action.summary);
      } else {
        console.log('[GuardClaw] SAFE:', action.summary);
      }
    } catch (error) {
      console.error('[GuardClaw] Safeguard analysis failed:', error);
      storedEvent.safeguard = {
        error: error.message,
        riskScore: 5,
        category: 'unknown'
      };
    }
  } else {
    storedEvent.safeguard = classifyNonExecEvent(eventDetails);
  }

  // For chat-message/chat-update events with streaming steps:
  // Use the HIGHEST risk score from all steps (worst-case)
  if ((eventDetails.type === 'chat-update' || eventDetails.type === 'chat-message') && 
      analyzedSteps.length > 0) {
    
    const stepsWithSafeguard = analyzedSteps.filter(s => s.safeguard?.riskScore !== undefined);
    
    if (stepsWithSafeguard.length > 0) {
      // Find the step with highest risk
      const maxRiskStep = stepsWithSafeguard.reduce((max, step) => 
        step.safeguard.riskScore > max.safeguard.riskScore ? step : max
      );
      
      // Use the worst-case risk for the overall event
      storedEvent.safeguard = {
        ...maxRiskStep.safeguard,
        reasoning: `Highest risk from ${stepsWithSafeguard.length} analyzed steps: ${maxRiskStep.safeguard.reasoning || 'N/A'}`,
        worstStep: {
          type: maxRiskStep.type,
          toolName: maxRiskStep.toolName,
          riskScore: maxRiskStep.safeguard.riskScore
        }
      };
      
      console.log(`[GuardClaw] 📊 Chat event risk: using max from steps (${maxRiskStep.safeguard.riskScore}) instead of overall (${storedEvent.safeguard?.riskScore || 0})`);
    }
  }

  eventStore.addEvent(storedEvent);

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
      // Analyze tool call
      const action = {
        type: step.toolName || 'unknown',
        tool: step.toolName,
        summary: `${step.toolName}: ${JSON.stringify(step.parsedInput || {}).substring(0, 100)}`,
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

// ─── Helper functions ────────────────────────────────────────────────────────

function shouldSkipEvent(eventDetails) {
  if (eventDetails.subType === 'delta' || eventDetails.subType === 'content_block_delta') {
    return true;
  }
  if (eventDetails.type === 'agent-message' && eventDetails.subType !== 'final') {
    return true;
  }
  if (eventDetails.type === 'tool-result') {
    return true;
  }
  if (eventDetails.type === 'exec-output') {
    return true;
  }
  if (eventDetails.type === 'health' || eventDetails.type === 'heartbeat') {
    return true;
  }
  return false;
}

function shouldAnalyzeEvent(eventDetails) {
  if (eventDetails.type === 'exec-started') return true;
  if (eventDetails.type === 'tool-call') return true;
  // Always analyze chat-update/agent-message that have content
  if (eventDetails.type === 'chat-update') return true;
  if (eventDetails.type === 'agent-message') return true;
  if (eventDetails.type === 'chat-message') return true;
  return false;
}

function extractAction(event, eventDetails) {
  const action = {
    type: eventDetails.tool || eventDetails.type,
    tool: eventDetails.tool,
    command: eventDetails.command,
    description: eventDetails.description,
    summary: '',
    raw: event
  };

  if (eventDetails.tool === 'exec') {
    action.summary = eventDetails.command || 'unknown exec command';
  } else if (eventDetails.tool === 'write') {
    const path = event.payload?.data?.input?.path || event.payload?.data?.input?.file_path || 'unknown';
    action.summary = `write file: ${path}`;
  } else if (eventDetails.tool === 'edit') {
    const path = event.payload?.data?.input?.path || event.payload?.data?.input?.file_path || 'unknown';
    action.summary = `edit file: ${path}`;
  } else if (eventDetails.tool === 'read') {
    const path = event.payload?.data?.input?.path || event.payload?.data?.input?.file_path || 'unknown';
    action.summary = `read file: ${path}`;
  } else if (eventDetails.tool === 'web_fetch') {
    const url = event.payload?.data?.input?.url || 'unknown';
    action.summary = `fetch URL: ${url}`;
  } else if (eventDetails.tool === 'browser') {
    const subAction = event.payload?.data?.input?.action || 'unknown';
    const url = event.payload?.data?.input?.targetUrl || '';
    action.summary = `browser ${subAction}${url ? ': ' + url : ''}`;
  } else if (eventDetails.tool === 'message') {
    const target = event.payload?.data?.input?.target || 'unknown';
    action.summary = `send message to: ${target}`;
  } else if (eventDetails.type === 'chat-update' || eventDetails.type === 'agent-message' || eventDetails.type === 'chat-message') {
    const text = eventDetails.description || '';
    action.summary = `chat message: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`;
    action.fullText = text;
  } else {
    action.summary = `${eventDetails.tool || eventDetails.type || 'unknown'}`;
  }

  return action;
}

function classifyNonExecEvent(eventDetails) {
  const type = eventDetails.type;

  if (type === 'health' || type === 'heartbeat' || type === 'connection') {
    return {
      riskScore: 0,
      category: 'safe',
      reasoning: 'System health check or heartbeat',
      allowed: true,
      warnings: [],
      backend: 'classification'
    };
  }

  if (type === 'chat-update' || type === 'agent-message') {
    return {
      riskScore: 0,
      category: 'safe',
      reasoning: 'Chat message',
      allowed: true,
      warnings: [],
      backend: 'classification'
    };
  }

  return {
    riskScore: 0,
    category: 'safe',
    reasoning: 'Unknown event type',
    allowed: true,
    warnings: [],
    backend: 'classification'
  };
}

function parseEventDetails(event) {
  const details = {
    type: 'unknown',
    subType: null,
    description: '',
    tool: null,
    command: null
  };

  const eventType = event.event || event.type;
  const payload = event.payload || {};

  if (eventType === 'exec.started') {
    details.type = 'exec-started';
    details.tool = 'exec';
    details.command = payload.command;
    details.description = `exec: ${payload.command || 'unknown'}`;
    return details;
  }

  if (eventType === 'exec.output') {
    details.type = 'exec-output';
    details.tool = 'exec';
    const output = payload.output || '';
    details.description = output.length > 100 ? output.substring(0, 100) + '...' : output;
    return details;
  }

  if (eventType === 'exec.completed') {
    details.type = 'exec-completed';
    details.tool = 'exec';
    details.description = `Completed (exit ${payload.exitCode || 0})`;
    return details;
  }

  switch (eventType) {
    case 'agent':
      if (payload.data?.type === 'tool_use') {
        details.type = 'tool-call';
        details.tool = payload.data.name;
        details.subType = payload.data.name;
        details.description = `${payload.data.name}`;

        if (payload.data.name === 'exec' && payload.data.input?.command) {
          details.command = payload.data.input.command;
          details.description = `exec: ${details.command}`;
        }

        return details;
      }

      if (payload.data?.type === 'tool_result') {
        details.type = 'tool-result';
        details.tool = 'result';
        details.subType = payload.data.tool_use_id || 'unknown';
        const content = payload.data.content?.[0]?.text || '';
        details.description = content.length > 100 ? content.substring(0, 100) + '...' : content;
        return details;
      }

      details.type = 'agent-message';
      details.subType = payload.stream || 'unknown';
      if (payload.data?.text) {
        const text = payload.data.text;
        details.description = text.length > 100 ? text.substring(0, 100) + '...' : text;
      }
      break;

    case 'chat':
      details.type = 'chat-update';
      details.subType = payload.state || 'unknown';
      if (payload.message?.content) {
        let text = '';
        const content = payload.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              text += block.text;
            }
          }
        } else if (typeof content === 'string') {
          text = content;
        }
        details.description = text || JSON.stringify(content).substring(0, 100);
      }
      break;

    case 'tick':
      details.type = 'heartbeat';
      details.description = 'Gateway heartbeat';
      break;

    case 'hello':
    case 'hello-ok':
      details.type = 'connection';
      details.description = 'Gateway connection';
      break;

    case 'health':
      details.type = 'health';
      details.description = 'Health check';
      break;

    default:
      details.type = eventType || 'unknown';
      if (payload.tool) {
        details.type = 'tool-call';
        details.tool = payload.tool;
        details.subType = payload.tool;
        details.description = `${payload.tool} called`;
      } else if (payload.stream) {
        details.subType = payload.stream;
        details.description = `Stream: ${payload.stream}`;
      }
  }

  return details;
}

function isExecCommand(event) {
  const eventType = event.event || event.type;
  if (eventType === 'exec.started') return true;
  if (eventType === 'exec.output') return false;
  if (eventType === 'exec.completed') return false;

  if (eventType === 'agent' && event.payload?.data?.type === 'tool_use') {
    return event.payload.data.name === 'exec';
  }

  const details = parseEventDetails(event);
  return details.tool === 'exec' && details.type === 'exec-started';
}

function extractCommand(event) {
  if (event.payload?.command) return event.payload.command;
  if (event.payload?.args?.command) return event.payload.args.command;
  if (event.command) return event.command;
  if (event.data?.command) return event.data.command;

  const details = parseEventDetails(event);
  return details.command || 'unknown command';
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
