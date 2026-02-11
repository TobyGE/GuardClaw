import WebSocket from 'ws';

export class ClawdbotClient {
  constructor(url, token, options = {}) {
    this.url = url;
    this.token = token;
    this.ws = null;
    this.connected = false;
    this.eventListeners = [];
    this.requestId = 0;
    this.pendingRequests = new Map();
    
    // Auto-reconnect settings
    this.autoReconnect = options.autoReconnect !== false;
    this.reconnectDelay = options.reconnectDelay || 5000;
    this.maxReconnectDelay = options.maxReconnectDelay || 30000;
    this.currentReconnectDelay = this.reconnectDelay;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.intentionalDisconnect = false;
    
    // Connection state callbacks
    this.onConnect = options.onConnect || (() => {});
    this.onDisconnect = options.onDisconnect || (() => {});
    this.onReconnecting = options.onReconnecting || (() => {});
  }

  async connect() {
    if (this.connected) {
      return { status: 'already_connected' };
    }

    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.intentionalDisconnect = false;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.ws?.close();
        const error = new Error('Connection timeout - is Clawdbot Gateway running?');
        reject(error);
        this.scheduleReconnect();
      }, 10000);

      try {
        this.ws = new WebSocket(this.url);
      } catch (error) {
        clearTimeout(timeout);
        reject(new Error(`Failed to create WebSocket: ${error.message}`));
        this.scheduleReconnect();
        return;
      }

      this.ws.on('open', () => {
        console.log('[ClawdbotClient] WebSocket opened');
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message, resolve, reject, timeout);
        } catch (error) {
          console.error('[ClawdbotClient] Failed to parse message:', error);
        }
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        console.error('[ClawdbotClient] WebSocket error:', error.message);
        // Don't reject here, let close event handle it
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        const wasConnected = this.connected;
        this.connected = false;
        
        console.log(`[ClawdbotClient] WebSocket closed: ${code} ${reason || '(no reason)'}`);
        
        if (wasConnected) {
          this.onDisconnect();
        }
        
        // Schedule reconnect if not intentional
        if (!this.intentionalDisconnect) {
          this.scheduleReconnect();
        }
      });
    });
  }

  handleMessage(message, connectResolve, connectReject, timeout) {
    // Handle connection challenge
    if (message.type === 'event' && message.event === 'connect.challenge') {
      this.handleChallenge(message.payload);
      return;
    }

    // Handle hello (connection successful)
    if (message.type === 'hello-ok' || (message.type === 'res' && message.payload?.type === 'hello-ok')) {
      clearTimeout(timeout);
      this.connected = true;
      
      // Reset reconnect state on successful connection
      this.reconnectAttempts = 0;
      this.currentReconnectDelay = this.reconnectDelay;
      
      console.log('[ClawdbotClient] ✅ Connected successfully');
      this.onConnect();
      connectResolve?.(message);
      return;
    }

    // Handle regular events
    if (message.type === 'event') {
      this.eventListeners.forEach(listener => {
        try {
          listener(message);
        } catch (error) {
          console.error('[ClawdbotClient] Event listener error:', error);
        }
      });
      return;
    }

    // Handle responses
    if (message.type === 'res') {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.ok) {
          pending.resolve(message.payload);
        } else {
          pending.reject(new Error(message.error?.message || 'Request failed'));
        }
      }
    }
  }

  handleChallenge(challenge) {
    if (!this.token || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[ClawdbotClient] Cannot respond to challenge - no token or connection');
      return;
    }

    const response = {
      type: 'req',
      id: `connect-${Date.now()}`,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'cli',
          version: '0.1.0',
          platform: 'linux',
          mode: 'cli'
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.admin'],
        caps: [],
        commands: [],
        permissions: {},
        locale: 'en-US',
        userAgent: 'guardclaw/0.1.0',
        auth: this.token ? { token: this.token } : undefined
      }
    };

    console.log('[ClawdbotClient] Responding to challenge');
    this.ws.send(JSON.stringify(response));
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

  async request(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    const id = `req-${++this.requestId}`;
    const request = {
      type: 'req',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(request));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  scheduleReconnect() {
    if (!this.autoReconnect || this.intentionalDisconnect) {
      return;
    }

    if (this.reconnectTimer) {
      return; // Already scheduled
    }

    this.reconnectAttempts++;
    
    // Exponential backoff with max delay
    const delay = Math.min(
      this.currentReconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    console.log(`[ClawdbotClient] 🔄 Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})...`);
    this.onReconnecting(this.reconnectAttempts, delay);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      console.log(`[ClawdbotClient] Attempting reconnect...`);
      
      try {
        await this.connect();
      } catch (error) {
        console.error('[ClawdbotClient] Reconnect failed:', error.message);
        // scheduleReconnect will be called by connect's error handler
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
    this.pendingRequests.clear();
    
    console.log('[ClawdbotClient] Disconnected (intentional)');
  }
  
  getConnectionStats() {
    return {
      connected: this.connected,
      reconnectAttempts: this.reconnectAttempts,
      autoReconnect: this.autoReconnect,
      pendingRequests: this.pendingRequests.size
    };
  }
}
