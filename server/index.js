#!/usr/bin/env node
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ClawdbotClient } from './clawdbot-client.js';
import { SafeguardService } from './safeguard.js';
import { EventStore } from './event-store.js';
import { SessionPoller } from './session-poller.js';
import { logger } from './logger.js';
import { installTracker } from './install-tracker.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('client/dist'));

// Services
const clawdbotClient = new ClawdbotClient(
  process.env.CLAWDBOT_URL || 'ws://127.0.0.1:18789',
  process.env.CLAWDBOT_TOKEN,
  {
    autoReconnect: true,
    reconnectDelay: 5000,
    maxReconnectDelay: 30000,
    onConnect: () => {
      logger.info('🎉 Connection established');
      // Restart session poller on reconnect
      if (sessionPoller.polling) {
        sessionPoller.testPermissions();
      }
    },
    onDisconnect: () => {
      logger.warn('💔 Connection lost');
    },
    onReconnecting: (attempt, delay) => {
      logger.info(`🔄 Reconnecting... (attempt ${attempt}, delay ${Math.round(delay/1000)}s)`);
    }
  }
);

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

const sessionPoller = new SessionPoller(
  clawdbotClient,
  safeguardService,
  eventStore
);

// SSE endpoint for real-time events
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

// API endpoints
app.get('/api/status', async (req, res) => {
  const connectionStats = clawdbotClient.getConnectionStats();
  const pollerStats = sessionPoller.getStats();
  const cacheStats = safeguardService.getCacheStats();
  const llmStatus = await safeguardService.testConnection();
  const installStats = installTracker.getStats();
  
  res.json({
    // Connection status
    connected: clawdbotClient.connected,
    connectionStats,
    
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
    healthy: clawdbotClient.connected && pollerStats.consecutiveErrors < 3,
    warnings: getSystemWarnings(connectionStats, pollerStats, llmStatus)
  });
});

function getSystemWarnings(connectionStats, pollerStats, llmStatus) {
  const warnings = [];
  
  if (!connectionStats.connected) {
    warnings.push({
      level: 'error',
      message: 'Not connected to Clawdbot Gateway',
      suggestion: 'Check if Clawdbot is running and CLAWDBOT_URL is correct'
    });
  }
  
  if (connectionStats.reconnectAttempts > 0) {
    warnings.push({
      level: 'warning',
      message: `Connection unstable (${connectionStats.reconnectAttempts} reconnect attempts)`,
      suggestion: 'Check network connectivity'
    });
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
    await clawdbotClient.connect();
    res.json({ status: 'connected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/disconnect', (req, res) => {
  clawdbotClient.disconnect();
  res.json({ status: 'disconnected' });
});

app.get('/api/events/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const events = eventStore.getRecentEvents(limit);
  res.json({ events: events.reverse() }); // Reverse so newest first
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

// Event handling
clawdbotClient.onEvent(async (event) => {
  // Debug: log ALL events to see what we're getting
  const eventType = event.event || event.type;
  
  // Log a few events in full to debug
  if (Math.random() < 0.05) { // 5% sampling
    console.log('[GuardClaw] 🔍 Sample event:', JSON.stringify(event, null, 2).substring(0, 500));
  }
  
  if (eventType && (eventType.startsWith('exec') || eventType === 'agent')) {
    console.log('[GuardClaw] 🔍 Important event:', JSON.stringify(event, null, 2));
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
      
      // Log risk level
      if (analysis.riskScore >= 8) {
        console.warn('[GuardClaw] 🔴 HIGH RISK:', action.summary);
      } else if (analysis.riskScore >= 4) {
        console.warn('[GuardClaw] 🟡 MEDIUM RISK:', action.summary);
      } else {
        console.log('[GuardClaw] 🟢 SAFE:', action.summary);
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
    // Only skip analysis for truly noise events
    storedEvent.safeguard = classifyNonExecEvent(eventDetails);
  }

  eventStore.addEvent(storedEvent);
});

// Helper functions
function shouldSkipEvent(eventDetails) {
  // Skip streaming intermediate events (delta, content_block_delta)
  if (eventDetails.subType === 'delta' || eventDetails.subType === 'content_block_delta') {
    return true;
  }
  
  // Skip agent-message lifecycle events (keep only final)
  if (eventDetails.type === 'agent-message' && eventDetails.subType !== 'final') {
    return true;
  }
  
  // Skip tool-result (they're just output, we care about the command itself)
  if (eventDetails.type === 'tool-result') {
    return true;
  }
  
  // Skip exec-output (too verbose, we only care about started/completed)
  if (eventDetails.type === 'exec-output') {
    return true;
  }
  
  // Skip noisy system events
  if (eventDetails.type === 'health' || eventDetails.type === 'heartbeat') {
    return true;
  }
  
  return false;
}

function shouldAnalyzeEvent(eventDetails) {
  // Analyze tool calls and commands
  if (eventDetails.type === 'exec-started') return true;
  if (eventDetails.type === 'tool-call') return true;
  
  // Analyze chat messages for security issues
  if (eventDetails.type === 'chat-update' && eventDetails.description) return true;
  if (eventDetails.type === 'agent-message' && eventDetails.description) return true;
  
  return false;
}

function extractAction(event, eventDetails) {
  // Extract action details for analysis
  const action = {
    type: eventDetails.tool || eventDetails.type,
    tool: eventDetails.tool,
    command: eventDetails.command,
    description: eventDetails.description,
    summary: '',
    raw: event
  };

  // Build summary for LM Studio
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
    // Chat content security analysis
    const text = eventDetails.description || '';
    action.summary = `chat message: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`;
    action.fullText = text;  // Store full text for analysis
  } else {
    action.summary = `${eventDetails.tool || eventDetails.type || 'unknown'}`;
  }

  return action;
}

function classifyNonExecEvent(eventDetails) {
  // Only for events we don't analyze (system events, chat messages)
  const type = eventDetails.type;
  
  // Safe system events
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
  
  // Chat messages (neutral/safe)
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
  
  // Unknown events (neutral)
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

  // Parse event type
  const eventType = event.event || event.type;
  const payload = event.payload || {};

  // Check for exec events first
  if (eventType === 'exec.started') {
    details.type = 'exec-started';
    details.tool = 'exec';
    details.command = payload.command;
    details.description = `🚀 exec: ${payload.command || 'unknown'}`;
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
    details.description = `✅ Completed (exit ${payload.exitCode || 0})`;
    return details;
  }

  // Parse based on event type
  switch (eventType) {
    case 'agent':
      // Check for tool_use in agent events
      if (payload.data?.type === 'tool_use') {
        details.type = 'tool-call';
        details.tool = payload.data.name;
        details.subType = payload.data.name;
        details.description = `🔧 ${payload.data.name}`;
        
        if (payload.data.name === 'exec' && payload.data.input?.command) {
          details.command = payload.data.input.command;
          details.description = `🔧 exec: ${details.command}`;
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
        // Extract text from content blocks
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
      // Try to extract more info from payload
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
  // Check event type directly
  const eventType = event.event || event.type;
  if (eventType === 'exec.started') return true;
  if (eventType === 'exec.output') return false; // Don't analyze output
  if (eventType === 'exec.completed') return false; // Don't analyze completion
  
  // Check for tool_use in agent events
  if (eventType === 'agent' && event.payload?.data?.type === 'tool_use') {
    return event.payload.data.name === 'exec';
  }
  
  // Fallback to parsed details
  const details = parseEventDetails(event);
  return details.tool === 'exec' && details.type === 'exec-started';
}

function extractCommand(event) {
  // Try different event structures
  if (event.payload?.command) return event.payload.command;
  if (event.payload?.args?.command) return event.payload.args.command;
  if (event.command) return event.command;
  if (event.data?.command) return event.data.command;
  
  // Use parsed details
  const details = parseEventDetails(event);
  return details.command || 'unknown command';
}

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('🛡️  GuardClaw - AI Agent Safety Monitor');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 Server:    http://localhost:${PORT}`);
  console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`🔧 API:       http://localhost:${PORT}/api/status`);
  console.log('');
  
  // Auto-connect to Clawdbot
  if (process.env.AUTO_CONNECT !== 'false') {
    console.log('🔌 Connecting to Clawdbot Gateway...');
    console.log(`   URL: ${process.env.CLAWDBOT_URL || 'ws://127.0.0.1:18789'}`);
    console.log('');
    
    clawdbotClient.connect()
      .then(async () => {
        console.log('');
        console.log('✅ Connected successfully!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`🛡️  Safeguard: ${safeguardService.backend.toUpperCase()}`);
        
        // Test LM Studio / LLM backend connection
        console.log('');
        console.log('🔍 Testing LLM backend connection...');
        const llmStatus = await safeguardService.testConnection();
        
        if (llmStatus.connected) {
          console.log(`✅ ${llmStatus.backend.toUpperCase()}: ${llmStatus.message}`);
          if (llmStatus.modelNames && llmStatus.modelNames.length > 0) {
            console.log(`   📦 Models: ${llmStatus.modelNames.join(', ')}`);
          }
        } else {
          console.log(`❌ ${llmStatus.backend.toUpperCase()}: ${llmStatus.message}`);
          if (llmStatus.backend === 'lmstudio') {
            console.log('');
            console.log('💡 LM Studio Setup:');
            console.log('   1. Download and install LM Studio from https://lmstudio.ai/');
            console.log('   2. Load a model (recommended: Mistral-7B-Instruct or Phi-2)');
            console.log('   3. Start the Local Server (default: http://localhost:1234)');
            console.log('   4. Or set SAFEGUARD_BACKEND=fallback in .env');
            console.log('');
            console.log('   GuardClaw will use pattern-matching fallback until LM Studio connects.');
          } else if (llmStatus.backend === 'ollama') {
            console.log('');
            console.log('💡 Ollama Setup:');
            console.log('   1. Install Ollama from https://ollama.ai/');
            console.log('   2. Run: ollama run llama3');
            console.log('   3. Or set SAFEGUARD_BACKEND=fallback in .env');
          }
        }
        
        // Fetch Gateway information
        console.log('');
        console.log('🔍 Fetching Gateway information...');
        try {
          // Get active sessions
          const sessionsResponse = await clawdbotClient.request('sessions.list', {
            activeMinutes: 60,
            limit: 10
          });
          
          const sessions = sessionsResponse.sessions || sessionsResponse || [];
          console.log(`✅ Gateway Status:`);
          console.log(`   📊 Active Sessions: ${sessions.length}`);
          
          if (sessions.length > 0) {
            console.log(`   🤖 Agents:`);
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
          } else {
            console.log(`   💤 No active sessions (agents will appear here when they start)`);
          }
        } catch (error) {
          console.log(`⚠️  Could not fetch Gateway info: ${error.message}`);
          if (error.message.includes('scope') || error.message.includes('admin')) {
            console.log(`   💡 Grant operator.admin scope to your token for full visibility`);
          }
        }
        
        // Start session poller in audit mode (scan history every 30s)
        const pollInterval = parseInt(process.env.POLL_INTERVAL) || 30000; // 30 seconds
        sessionPoller.start(pollInterval);
        console.log('');
        console.log('🎯 GuardClaw is now monitoring your agents!');
        console.log('');
      })
      .catch((err) => {
        console.error('');
        console.error('❌ Initial connection failed:', err.message);
        console.error('');
        if (clawdbotClient.autoReconnect) {
          console.log('🔄 Auto-reconnect enabled - will retry automatically');
          console.log('');
        } else {
          console.error('💡 Troubleshooting:');
          console.error('   1. Check if Clawdbot Gateway is running');
          console.error('   2. Verify CLAWDBOT_URL in .env');
          console.error('   3. Verify CLAWDBOT_TOKEN is correct');
          console.error('');
        }
      });
  } else {
    console.log('⏸️  Auto-connect disabled (AUTO_CONNECT=false)');
    console.log('   Use POST /api/connect to connect manually');
    console.log('');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('');
  console.log('🛑 Shutting down GuardClaw...');
  console.log('');
  
  sessionPoller.stop();
  clawdbotClient.disconnect();
  
  console.log('✅ Shutdown complete');
  console.log('');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('');
  console.log('🛑 Received SIGTERM, shutting down...');
  console.log('');
  
  sessionPoller.stop();
  clawdbotClient.disconnect();
  
  process.exit(0);
});
