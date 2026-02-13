// Session polling for command history
// Since we can't get real-time exec events, we poll session history
// Falls back to event-only mode if we don't have operator.admin scope

export class SessionPoller {
  constructor(openclawClient, safeguardService, eventStore) {
    this.client = openclawClient;
    this.safeguard = safeguardService;
    this.eventStore = eventStore;
    this.seenCommands = new Set();
    this.polling = false;
    this.interval = null;
    
    // Permission and mode tracking
    this.hasAdminScope = null; // null = unknown, true/false = tested
    this.mode = 'unknown'; // 'polling' or 'event-only'
    this.consecutiveErrors = 0;
    this.maxConsecutiveErrors = 3;
  }

  start(intervalMs = 30000) {
    if (this.polling) return;
    
    console.log(`[SessionPoller] Starting audit mode with ${intervalMs/1000}s scan interval`);
    this.polling = true;
    
    // Test permissions first
    this.testPermissions().then(() => {
      if (this.mode === 'polling') {
        // Poll immediately
        this.poll();
        
        // Then poll periodically (audit mode - scan all sessions)
        this.interval = setInterval(() => this.poll(), intervalMs);
      } else {
        console.log('[SessionPoller] ⚠️  Audit mode unavailable');
        console.log('[SessionPoller] Only real-time events will be captured');
        console.log('[SessionPoller] To enable audit: ensure sessions.list + chat.history API access');
      }
    });
  }
  
  async testPermissions() {
    if (!this.client.connected) {
      console.log('[SessionPoller] Not connected, skipping permission test');
      return;
    }
    
    try {
      console.log('[SessionPoller] Testing audit mode (sessions.list + chat.history)...');
      
      // Test sessions.list
      const response = await this.client.request('sessions.list', {
        limit: 1
      });
      
      const sessions = response.sessions || response || [];
      
      // Test chat.history if we have sessions
      if (sessions.length > 0) {
        try {
          await this.client.request('chat.history', {
            sessionKey: sessions[0].key,
            limit: 1
          });
          
          this.hasAdminScope = true;
          this.mode = 'polling';
          this.consecutiveErrors = 0;
          console.log('[SessionPoller] ✅ Audit mode enabled (sessions.list + chat.history)');
          console.log('[SessionPoller] Will scan history every 30s for risky commands');
          return;
        } catch (historyError) {
          console.warn('[SessionPoller] ⚠️  chat.history failed:', historyError.message);
          this.hasAdminScope = false;
          this.mode = 'event-only';
          return;
        }
      }
      
      // If no sessions, assume we have permissions but can't test yet
      this.hasAdminScope = true;
      this.mode = 'polling';
      this.consecutiveErrors = 0;
      console.log('[SessionPoller] ✅ Permissions OK (no active sessions yet)');
    } catch (error) {
      if (error.message.includes('scope') || error.message.includes('admin')) {
        console.warn('[SessionPoller] ⚠️  Missing required scope');
        this.hasAdminScope = false;
        this.mode = 'event-only';
      } else if (error.message.includes('unknown method')) {
        console.warn('[SessionPoller] ⚠️  API method not supported');
        this.hasAdminScope = false;
        this.mode = 'event-only';
      } else {
        console.error('[SessionPoller] Permission test failed:', error.message);
        this.hasAdminScope = false;
        this.mode = 'event-only';
      }
    }
  }
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.polling = false;
    console.log('[SessionPoller] Stopped');
  }

  async poll() {
    console.log('[SessionPoller] 🔄 Starting poll cycle...');
    
    if (!this.client.connected) {
      console.log('[SessionPoller] ⚠️  Not connected, skipping poll');
      return;
    }

    // If we know we don't have permissions or API not supported, don't try
    if (this.hasAdminScope === false) {
      console.log('[SessionPoller] ⚠️  No admin scope, skipping poll');
      return;
    }

    try {
      console.log('[SessionPoller] 📋 Fetching active sessions...');
      
      // Get recent sessions
      const response = await this.client.request('sessions.list', {
        activeMinutes: 30,
        limit: 5
      });

      const sessions = response.sessions || response || [];
      console.log(`[SessionPoller] Found ${sessions.length} active sessions`);
      
      // Reset error counter on success
      this.consecutiveErrors = 0;
      
      if (sessions.length === 0) {
        return;
      }
      
      for (const session of sessions) {
        await this.analyzeSession(session);
      }
    } catch (error) {
      this.consecutiveErrors++;
      
      // Check if it's a permission error
      if (error.message.includes('scope') || error.message.includes('admin')) {
        console.warn('[SessionPoller] ⚠️  Permission denied - switching to event-only mode');
        this.hasAdminScope = false;
        this.mode = 'event-only';
        return;
      }
      
      // Check if API method not supported
      if (error.message.includes('unknown method')) {
        console.warn('[SessionPoller] ⚠️  API not supported - switching to event-only mode');
        this.hasAdminScope = false;
        this.mode = 'event-only';
        return;
      }
      
      // If too many consecutive errors, back off
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        console.error(`[SessionPoller] Too many errors (${this.consecutiveErrors}), pausing polling`);
        console.error('[SessionPoller] Will retry on next activity');
        this.hasAdminScope = false; // Temporarily disable
        this.mode = 'event-only';
      } else {
        console.error('[SessionPoller] Poll failed:', error.message);
      }
    }
  }

  async analyzeSession(session) {
    try {
      console.log(`[SessionPoller] 📜 Fetching history for session: ${session.key}`);
      
      // Get chat history using chat.history API
      const response = await this.client.request('chat.history', {
        sessionKey: session.key,
        limit: 50
      });

      const history = response.messages || response || [];
      console.log(`[SessionPoller] Found ${history.length} messages in history`);
      
      if (history.length === 0) {
        console.log('[SessionPoller] No messages, skipping');
        return;
      }
      
      // Extract all tool calls from history
      const toolCalls = this.extractToolCalls(history);
      console.log(`[SessionPoller] Extracted ${toolCalls.length} tool calls`);

      if (toolCalls.length === 0) {
        console.log('[SessionPoller] No tool calls found');
        return;
      }

      for (const call of toolCalls) {
        // Skip if already analyzed
        const callKey = `${session.key}:${call.id}:${call.tool}`;
        if (this.seenCommands.has(callKey)) {
          continue;
        }

        this.seenCommands.add(callKey);

        // Analyze tool call (with error handling)
        let analysis;
        try {
          analysis = await this.safeguard.analyzeAction(call.action);
        } catch (error) {
          console.error(`[SessionPoller] Analysis failed for: ${call.summary}`, error.message);
          analysis = {
            riskScore: 5,
            category: 'unknown',
            reasoning: `Analysis failed: ${error.message}`,
            recommendation: 'review',
            error: error.message
          };
        }

        // Create event
        const event = {
          id: `poll-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: call.timestamp || Date.now(),
          rawEvent: call.raw || {},
          type: 'tool-call',
          subType: call.tool,
          description: call.summary,
          tool: call.tool,
          command: call.command || null,
          safeguard: analysis,
          sessionKey: session.key,
          polled: true
        };

        this.eventStore.addEvent(event);

        // Log risk (more compact)
        const riskEmoji = analysis.riskScore >= 8 ? '🔴' : analysis.riskScore >= 4 ? '🟡' : '🟢';
        console.log(`[SessionPoller] ${riskEmoji} ${analysis.riskScore}/10 [${call.tool}]: ${call.summary.substring(0, 60)}${call.summary.length > 60 ? '...' : ''}`);
      }

      // Cleanup old seen commands (keep last 1000)
      if (this.seenCommands.size > 1000) {
        const arr = Array.from(this.seenCommands);
        this.seenCommands = new Set(arr.slice(-1000));
      }
    } catch (error) {
      // Re-throw specific errors to be caught by poll()
      if (error.message.includes('scope') || 
          error.message.includes('admin') || 
          error.message.includes('unknown method')) {
        throw error;
      }
      
      // Log other errors but don't stop
      console.error('[SessionPoller] Session analysis failed:', error.message);
    }
  }

  extractToolCalls(messages) {
    const toolCalls = [];
    let assistantCount = 0;
    let toolUseCount = 0;

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      assistantCount++;

      const content = msg.content || [];
      
      // Debug: log first assistant message structure
      if (assistantCount === 1 && content.length > 0) {
        console.log(`[SessionPoller] 🔍 Sample assistant message content:`, JSON.stringify(content.slice(0, 2), null, 2).substring(0, 300));
      }
      
      for (const block of content) {
        // Look for toolCall blocks (chat.history format) or tool_use blocks (event format)
        if (block.type === 'toolCall' || block.type === 'tool_use') {
          toolUseCount++;
          
          const toolName = block.name;
          if (!toolName) continue;
          
          // Extract action details based on tool type
          const action = this.buildActionFromBlock(block, toolName, msg);
          
          if (action) {
            toolCalls.push({
              id: block.id || `call-${Date.now()}-${Math.random()}`,
              tool: toolName,
              action,
              command: action.command,
              summary: action.summary,
              timestamp: msg.timestamp || Date.now(),
              raw: msg
            });
          }
        }
      }
    }

    console.log(`[SessionPoller] 📊 Stats: ${assistantCount} assistant messages, ${toolUseCount} tool_use blocks, ${toolCalls.length} tool calls extracted`);
    return toolCalls;
  }

  buildActionFromBlock(block, toolName, msg) {
    // Handle different formats: chat.history uses 'arguments', events use 'input'
    const args = block.arguments || block.input || block.params || {};
    
    const action = {
      type: toolName,
      tool: toolName,
      summary: '',
      command: null,
      raw: block
    };

    // Build summary based on tool type
    switch (toolName) {
      case 'exec':
        action.command = args.command;
        action.summary = args.command || 'unknown exec command';
        break;
        
      case 'read':
        const readPath = args.path || args.file_path || 'unknown';
        action.summary = `read file: ${readPath}`;
        break;
        
      case 'write':
        const writePath = args.path || args.file_path || 'unknown';
        action.summary = `write file: ${writePath}`;
        break;
        
      case 'edit':
        const editPath = args.path || args.file_path || 'unknown';
        action.summary = `edit file: ${editPath}`;
        break;
        
      case 'web_fetch':
        const url = args.url || 'unknown';
        action.summary = `fetch URL: ${url}`;
        break;
        
      case 'web_search':
        const query = args.query || 'unknown';
        action.summary = `search: ${query}`;
        break;
        
      case 'browser':
        const browserAction = args.action || 'unknown';
        const targetUrl = args.targetUrl || '';
        action.summary = `browser ${browserAction}${targetUrl ? ': ' + targetUrl : ''}`;
        break;
        
      case 'message':
        const target = args.target || 'unknown';
        action.summary = `send message to: ${target}`;
        break;
        
      case 'process':
        const processAction = args.action || 'unknown';
        action.summary = `process ${processAction}`;
        break;
        
      default:
        // For unknown tools, just use the tool name
        action.summary = `${toolName}`;
    }

    return action;
  }

  getStats() {
    return {
      polling: this.polling,
      mode: this.mode,
      hasAdminScope: this.hasAdminScope,
      seenCommands: this.seenCommands.size,
      consecutiveErrors: this.consecutiveErrors
    };
  }
}
