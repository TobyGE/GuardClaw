#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ClawdbotClient } from './clawdbot-client.js';
import { NanobotClient } from './nanobot-client.js';
import { SafeguardService } from './safeguard.js';
import { EventStore } from './event-store.js';
import { SessionPoller } from './session-poller.js';
import { logger } from './logger.js';
import { installTracker } from './install-tracker.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

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

// ─── SSE endpoint for real-time events ───────────────────────────────────────

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const listener = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
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

  // Per-backend connection status
  const backends = {};
  for (const { client, name } of activeClients) {
    backends[name] = client.getConnectionStats();
  }

  // Connected if ANY backend is connected
  const anyConnected = activeClients.some(({ client }) => client.connected);

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

    // Install tracking
    install: installStats,

    // Health
    healthy: anyConnected && pollerStats.consecutiveErrors < 3,
    warnings: getSystemWarnings(backends, pollerStats, llmStatus)
  });
});

function getSystemWarnings(backends, pollerStats, llmStatus) {
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

app.post('/api/safeguard/analyze', async (req, res) => {
  const { command } = req.body;
  try {
    const analysis = await safeguardService.analyzeCommand(command);
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Event handling (shared across all backends) ─────────────────────────────

async function handleAgentEvent(event) {
  const eventType = event.event || event.type;

  // Debug logging
  if (Math.random() < 0.05) {
    console.log('[GuardClaw] Sample event:', JSON.stringify(event, null, 2).substring(0, 500));
  }

  if (eventType && (eventType.startsWith('exec') || eventType === 'agent')) {
    console.log('[GuardClaw] Important event:', JSON.stringify(event, null, 2));
  } else {
    console.log('[GuardClaw] Event received:', eventType);
  }

  // Parse and enrich event
  const eventDetails = parseEventDetails(event);

  // Filter out noisy intermediate events
  if (shouldSkipEvent(eventDetails)) {
    return;
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
    payload: event.payload || event
  };

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

  eventStore.addEvent(storedEvent);
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
  if (eventDetails.type === 'chat-update' && eventDetails.description) return true;
  if (eventDetails.type === 'agent-message' && eventDetails.description) return true;
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
  } else if (eventDetails.type === 'chat-update' || eventDetails.type === 'agent-message') {
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
