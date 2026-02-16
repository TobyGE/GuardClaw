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
    const runId = payload.runId || 'unknown';

    // OpenClaw format: stream can be 'thinking', 'tool', 'assistant', etc.
    // Start a new step for each stream type if needed
    
    if (stream === 'thinking' && data.delta) {
      // Thinking stream
      let currentThinking = session.steps.find(s => s.runId === runId && s.type === 'thinking' && !s.endTime);
      if (!currentThinking) {
        currentThinking = {
          id: `${runId}-thinking-${session.steps.length}`,
          timestamp: Date.now(),
          type: 'thinking',
          content: '',
          runId: runId,
          metadata: {}
        };
        session.steps.push(currentThinking);
      }
      currentThinking.content += data.delta || '';
    } else if (stream === 'tool' && data.name) {
      // Tool use stream - OpenClaw format uses toolCallId
      const toolId = data.toolCallId || data.id;
      const phase = data.phase || 'update';
      
      let currentTool = session.steps.find(s => s.toolId === toolId && s.type === 'tool_use');
      
      // Create step on first phase (start or update)
      if (!currentTool) {
        currentTool = {
          id: `${runId}-tool-${toolId}`,
          timestamp: payload.ts || Date.now(),
          type: 'tool_use',
          toolName: data.name,
          toolId: toolId,
          content: '',
          phase: phase,
          runId: runId,
          metadata: { 
            tool: data.name,
            phases: [phase]
          }
        };
        session.steps.push(currentTool);
      } else {
        // Track phase progression
        if (!currentTool.metadata.phases.includes(phase)) {
          currentTool.metadata.phases.push(phase);
        }
        currentTool.phase = phase;
      }
      
      // Handle different phases
      if (phase === 'start') {
        currentTool.startTime = payload.ts || Date.now();
        // OpenClaw uses 'args' for input parameters
        if (data.args) {
          currentTool.parsedInput = data.args;
          currentTool.content = JSON.stringify(data.args, null, 2);
          currentTool.metadata.input = data.args;
        }
        // Also support standard 'input' field
        if (data.input) {
          currentTool.parsedInput = data.input;
          currentTool.content = JSON.stringify(data.input, null, 2);
          currentTool.metadata.input = data.input;
        }
      } else if (phase === 'update') {
        // Accumulate deltas if present
        if (data.delta) {
          currentTool.content += data.delta;
        }
        // Update with partial results
        if (data.partialResult) {
          currentTool.metadata.partialResult = data.partialResult;
        }
      } else if (phase === 'result') {
        // Finalize with result
        // OpenClaw uses 'meta' for result summary
        if (data.meta !== undefined) {
          currentTool.result = data.meta;
          currentTool.metadata.result = data.meta;
          currentTool.metadata.isError = data.isError;
        }
        // Also support standard 'result' field
        if (data.result !== undefined) {
          currentTool.result = data.result;
          currentTool.metadata.result = data.result;
        }
        currentTool.endTime = payload.ts || Date.now();
        currentTool.duration = currentTool.endTime - (currentTool.startTime || currentTool.timestamp);
      }
    } else if (stream === 'assistant' && data.delta) {
      // Assistant text stream
      let currentText = session.steps.find(s => s.runId === runId && s.type === 'text' && !s.endTime);
      if (!currentText) {
        currentText = {
          id: `${runId}-text-${session.steps.length}`,
          timestamp: Date.now(),
          type: 'text',
          content: '',
          runId: runId,
          metadata: {}
        };
        session.steps.push(currentText);
      }
      currentText.content += data.delta || '';
    }

    // Finalize steps when stream ends
    if (data.type === 'message_stop' || stream === 'final') {
      for (const step of session.steps) {
        if (step.runId === runId && !step.endTime) {
          step.endTime = Date.now();
          step.duration = step.endTime - step.timestamp;
        }
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

  // Get recent steps for a session (sorted by timestamp)
  getSessionSteps(sessionKey, limit = 50) {
    const session = this.sessions.get(sessionKey);
    if (!session) return [];
    
    // Sort by timestamp (oldest first)
    const sorted = [...session.steps].sort((a, b) => a.timestamp - b.timestamp);
    return sorted.slice(-limit);
  }

  // Get steps for a specific runId only (avoids duplication between runs)
  getStepsForRun(sessionKey, runId) {
    const session = this.sessions.get(sessionKey);
    if (!session) return [];
    
    // Filter by runId and sort by timestamp
    return session.steps
      .filter(s => s.runId === runId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  // Clear steps for a specific runId (cleanup after processing)
  clearStepsForRun(sessionKey, runId) {
    const session = this.sessions.get(sessionKey);
    if (!session) return;
    
    // Remove steps with this runId
    session.steps = session.steps.filter(s => s.runId !== runId);
    console.log(`[StreamingTracker] Cleared ${session.steps.length} steps for runId ${runId}`);
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
