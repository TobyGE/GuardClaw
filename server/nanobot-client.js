import WebSocket from 'ws';

/**
 * WebSocket client for nanobot's monitoring server.
 * Connects to nanobot's monitoring WebSocket, normalizes events to the format
 * that parseEventDetails() already handles, and feeds them into the same
 * analysis pipeline as OpenClaw events.
 */
export class NanobotClient {
  constructor(url, options = {}) {
    this.url = url || 'ws://127.0.0.1:18790';
    this.ws = null;
    this.connected = false;
    this.eventListeners = [];

    // Auto-reconnect settings
    this.autoReconnect = options.autoReconnect !== false;
    this.reconnectDelay = options.reconnectDelay || 5000;
    this.maxReconnectDelay = options.maxReconnectDelay || 30000;
    this.currentReconnectDelay = this.reconnectDelay;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.intentionalDisconnect = false;

    // Connection state callbacks
    this.onConnectCb = options.onConnect || (() => {});
    this.onDisconnectCb = options.onDisconnect || (() => {});
    this.onReconnectingCb = options.onReconnecting || (() => {});
  }

  async connect() {
    if (this.connected) {
      return { status: 'already_connected' };
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.intentionalDisconnect = false;

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fn(value);
      };

      const timeout = setTimeout(() => {
        this.ws?.close();
        settle(reject, new Error('Connection timeout - is nanobot gateway running?'));
        this.scheduleReconnect();
      }, 10000);

      try {
        this.ws = new WebSocket(this.url);
      } catch (error) {
        settle(reject, new Error(`Failed to create WebSocket: ${error.message}`));
        this.scheduleReconnect();
        return;
      }

      this.ws.on('open', () => {
        console.log('[NanobotClient] WebSocket opened');
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          // Handle hello message as connection success
          if (message.type === 'hello' && message.agent === 'nanobot') {
            this.connected = true;
            this.reconnectAttempts = 0;
            this.currentReconnectDelay = this.reconnectDelay;
            console.log('[NanobotClient] Connected to nanobot monitor');
            this.onConnectCb();
            settle(resolve, message);
            return;
          }

          // Normalize and emit events
          if (message.type === 'event') {
            const normalized = this.normalizeEvent(message);
            if (normalized) {
              this.eventListeners.forEach(listener => {
                try {
                  listener(normalized);
                } catch (error) {
                  console.error('[NanobotClient] Event listener error:', error);
                }
              });
            }
          }
        } catch (error) {
          console.error('[NanobotClient] Failed to parse message:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('[NanobotClient] WebSocket error:', error.message);
      });

      this.ws.on('close', (code, reason) => {
        const wasConnected = this.connected;
        this.connected = false;

        console.log(`[NanobotClient] WebSocket closed: ${code} ${reason || '(no reason)'}`);

        if (wasConnected) {
          this.onDisconnectCb();
        } else {
          // Never connected — reject so Promise.allSettled() can proceed
          settle(reject, new Error(`Connection refused: ${code} ${reason || '(no reason)'}`));
        }

        if (!this.intentionalDisconnect) {
          this.scheduleReconnect();
        }
      });
    });
  }

  /**
   * Normalize nanobot monitoring events into the format that
   * parseEventDetails() in index.js already understands.
   */
  normalizeEvent(message) {
    const { event, tool, arguments: args, result, error, timestamp } = message;

    if (event === 'tool.started') {
      if (tool === 'exec') {
        // Map to exec.started — handled directly by parseEventDetails
        return {
          type: 'event',
          event: 'exec.started',
          payload: {
            command: args?.command || '',
          },
          timestamp,
        };
      }
      // All other tools → agent tool_use event
      return {
        type: 'event',
        event: 'agent',
        payload: {
          data: {
            type: 'tool_use',
            name: tool,
            input: args || {},
          },
        },
        timestamp,
      };
    }

    if (event === 'tool.completed') {
      if (tool === 'exec') {
        return {
          type: 'event',
          event: 'exec.completed',
          payload: {
            exitCode: error ? 1 : 0,
            command: args?.command || '',
          },
          timestamp,
        };
      }
      // Non-exec completions → agent tool_result
      return {
        type: 'event',
        event: 'agent',
        payload: {
          data: {
            type: 'tool_result',
            tool_use_id: `${tool}-${timestamp}`,
            content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result || '') }],
          },
        },
        timestamp,
      };
    }

    if (event === 'heartbeat') {
      return {
        type: 'event',
        event: 'tick',
        payload: {},
        timestamp,
      };
    }

    return null;
  }

  onEvent(callback) {
    this.eventListeners.push(callback);
    return () => {
      const index = this.eventListeners.indexOf(callback);
      if (index >= 0) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  scheduleReconnect() {
    if (!this.autoReconnect || this.intentionalDisconnect) {
      return;
    }
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts++;

    const delay = Math.min(
      this.currentReconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    console.log(`[NanobotClient] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})...`);
    this.onReconnectingCb(this.reconnectAttempts, delay);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (error) {
        console.error('[NanobotClient] Reconnect failed:', error.message);
      }
    }, delay);
  }

  disconnect() {
    this.intentionalDisconnect = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.eventListeners = [];

    console.log('[NanobotClient] Disconnected (intentional)');
  }

  getConnectionStats() {
    return {
      connected: this.connected,
      reconnectAttempts: this.reconnectAttempts,
      autoReconnect: this.autoReconnect,
      pendingRequests: 0,
    };
  }
}
