// Streaming session tracker for detailed step-by-step monitoring
// Tracks thinking, tool calls, and responses in a conversation flow

export class StreamingTracker {
  constructor() {
    this.sessions = new Map(); // sessionKey -> SessionData
    this.maxSessions = 100; // Keep last 100 sessions
  }

  // Get or create session
  getSession(sessionKey) {
    if (!this.sessions.has(sessionKey)) {
      this.sessions.set(sessionKey, {
        key: sessionKey,
        startTime: Date.now(),
        steps: [],
        currentMessage: null
      });

      // Cleanup old sessions
      if (this.sessions.size > this.maxSessions) {
        const oldestKey = this.sessions.keys().next().value;
        this.sessions.delete(oldestKey);
      }
    }
    return this.sessions.get(sessionKey);
  }

  // Track a streaming event
  trackEvent(event) {
    const sessionKey = event.payload?.sessionKey || 'default';
    const session = this.getSession(sessionKey);

    const eventType = event.event || event.type;
    const payload = event.payload || {};

    // Track different types of content blocks
    if (eventType === 'agent' || eventType === 'chat') {
      this.handleAgentEvent(session, event, payload);
    } else if (eventType?.startsWith('exec')) {
      this.handleExecEvent(session, event, payload);
    }

    return session;
  }

  handleAgentEvent(session, event, payload) {
    const data = payload.data || {};
    const stream = payload.stream;

    // Start of a new message
    if (stream === 'message_start' || data.type === 'message_start') {
      session.currentMessage = {
        id: data.id || `msg-${Date.now()}`,
        startTime: Date.now(),
        steps: []
      };
    }

    // Content blocks (thinking, tool_use, text)
    if (data.type === 'content_block_start') {
      const block = data.content_block || {};
      const step = {
        id: `${session.currentMessage?.id || 'unknown'}-${session.steps.length}`,
        timestamp: Date.now(),
        type: block.type, // 'thinking', 'tool_use', 'text'
        content: '',
        metadata: {}
      };

      if (block.type === 'tool_use') {
        step.toolName = block.name;
        step.toolId = block.id;
        step.metadata.tool = block.name;
      }

      session.steps.push(step);
      session.currentMessage?.steps.push(step);
    }

    // Content deltas (streaming content)
    if (data.type === 'content_block_delta') {
      const delta = data.delta || {};
      const index = data.index;
      
      if (session.steps.length > 0) {
        const currentStep = session.steps[session.steps.length - 1];
        
        if (delta.type === 'thinking_delta') {
          currentStep.content += delta.thinking || '';
          currentStep.type = 'thinking';
        } else if (delta.type === 'text_delta') {
          currentStep.content += delta.text || '';
          currentStep.type = 'text';
        } else if (delta.type === 'input_json_delta') {
          currentStep.content += delta.partial_json || '';
          currentStep.type = 'tool_use';
        }
      }
    }

    // Content block stop (finalize)
    if (data.type === 'content_block_stop') {
      if (session.steps.length > 0) {
        const currentStep = session.steps[session.steps.length - 1];
        currentStep.endTime = Date.now();
        currentStep.duration = currentStep.endTime - currentStep.timestamp;
        
        // Parse tool input if it's a tool_use step
        if (currentStep.type === 'tool_use' && currentStep.content) {
          try {
            currentStep.parsedInput = JSON.parse(currentStep.content);
            currentStep.metadata.input = currentStep.parsedInput;
          } catch (e) {
            console.warn('[StreamingTracker] Failed to parse tool input:', e.message);
          }
        }
      }
    }

    // Message stop (end of message)
    if (stream === 'message_stop' || data.type === 'message_stop') {
      if (session.currentMessage) {
        session.currentMessage.endTime = Date.now();
        session.currentMessage.duration = session.currentMessage.endTime - session.currentMessage.startTime;
        session.currentMessage = null;
      }
    }
  }

  handleExecEvent(session, event, payload) {
    const eventType = event.event || event.type;
    
    if (eventType === 'exec.started') {
      const step = {
        id: `exec-${Date.now()}`,
        timestamp: Date.now(),
        type: 'exec',
        command: payload.command,
        content: payload.command,
        metadata: {
          tool: 'exec',
          cwd: payload.cwd,
          sessionKey: payload.sessionKey
        }
      };
      session.steps.push(step);
    } else if (eventType === 'exec.output') {
      // Find the most recent exec step
      for (let i = session.steps.length - 1; i >= 0; i--) {
        if (session.steps[i].type === 'exec' && !session.steps[i].output) {
          session.steps[i].output = payload.output;
          session.steps[i].metadata.output = payload.output;
          break;
        }
      }
    } else if (eventType === 'exec.completed') {
      // Find the most recent exec step
      for (let i = session.steps.length - 1; i >= 0; i--) {
        if (session.steps[i].type === 'exec' && !session.steps[i].endTime) {
          session.steps[i].endTime = Date.now();
          session.steps[i].duration = session.steps[i].endTime - session.steps[i].timestamp;
          session.steps[i].exitCode = payload.exitCode;
          session.steps[i].metadata.exitCode = payload.exitCode;
          break;
        }
      }
    }
  }

  // Get recent steps for a session
  getSessionSteps(sessionKey, limit = 50) {
    const session = this.sessions.get(sessionKey);
    if (!session) return [];
    
    return session.steps.slice(-limit);
  }

  // Get all sessions
  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  // Clear old sessions
  cleanup(olderThanMs = 3600000) { // 1 hour default
    const cutoff = Date.now() - olderThanMs;
    for (const [key, session] of this.sessions.entries()) {
      if (session.startTime < cutoff) {
        this.sessions.delete(key);
      }
    }
  }
}

export const streamingTracker = new StreamingTracker();
