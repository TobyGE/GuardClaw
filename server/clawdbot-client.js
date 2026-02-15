import WebSocket from 'ws';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Device Identity Helpers ─────────────────────────────────────────────────

const IDENTITY_DIR = path.join(os.homedir(), '.guardclaw', 'identity');
const IDENTITY_FILE = path.join(IDENTITY_DIR, 'device.json');

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function base64UrlEncode(buf) {
  return buf.toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

function derivePublicKeyRaw(publicKeyPem) {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  if (spki.length === ED25519_SPKI_PREFIX.length + 32 &&
      spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function fingerprintPublicKey(publicKeyPem) {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function publicKeyRawBase64Url(publicKeyPem) {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function generateIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    deviceId: fingerprintPublicKey(publicKeyPem),
    publicKeyPem,
    privateKeyPem
  };
}

function loadOrCreateDeviceIdentity() {
  try {
    if (fs.existsSync(IDENTITY_FILE)) {
      const raw = fs.readFileSync(IDENTITY_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.version === 1 &&
          typeof parsed.deviceId === 'string' &&
          typeof parsed.publicKeyPem === 'string' &&
          typeof parsed.privateKeyPem === 'string') {
        const derivedId = fingerprintPublicKey(parsed.publicKeyPem);
        return {
          deviceId: derivedId,
          publicKeyPem: parsed.publicKeyPem,
          privateKeyPem: parsed.privateKeyPem
        };
      }
    }
  } catch (err) {
    console.warn('[OpenClawClient] Could not load device identity, generating new one:', err.message);
  }

  const identity = generateIdentity();
  fs.mkdirSync(IDENTITY_DIR, { recursive: true });
  const stored = {
    version: 1,
    deviceId: identity.deviceId,
    publicKeyPem: identity.publicKeyPem,
    privateKeyPem: identity.privateKeyPem,
    createdAtMs: Date.now()
  };
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(IDENTITY_FILE, 0o600); } catch {}

  console.log('[OpenClawClient] Generated new device identity:', identity.deviceId.substring(0, 16) + '...');
  return identity;
}

function signDevicePayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, 'utf8'), key));
}

function buildDeviceAuthPayload(params) {
  const version = params.nonce ? 'v2' : 'v1';
  const scopes = params.scopes.join(',');
  const token = params.token ?? '';
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token
  ];
  if (version === 'v2') base.push(params.nonce ?? '');
  return base.join('|');
}

// ─── OpenClaw Config Auto-Discovery ──────────────────────────────────────────

function discoverOpenClawConfig() {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(raw);
      const gateway = config?.gateway || {};
      return {
        url: `ws://127.0.0.1:${gateway.port || 18789}`,
        token: gateway.auth?.token || null
      };
    }
  } catch (err) {
    console.warn('[OpenClawClient] Could not read OpenClaw config:', err.message);
  }
  return null;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class ClawdbotClient {
  constructor(url, token, options = {}) {
    // Auto-discover OpenClaw config if no token provided
    if (!token) {
      const discovered = discoverOpenClawConfig();
      if (discovered) {
        if (!url || url === 'ws://127.0.0.1:18789') {
          url = discovered.url;
        }
        if (discovered.token) {
          token = discovered.token;
          console.log('[OpenClawClient] Auto-discovered gateway token from ~/.openclaw/openclaw.json');
        }
      }
    }

    this.url = url;
    this.token = token;
    this.ws = null;
    this.connected = false;
    this.eventListeners = [];
    this.requestId = 0;
    this.pendingRequests = new Map();

    // Load or create device identity for gateway auth
    this.deviceIdentity = loadOrCreateDeviceIdentity();

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
        const error = new Error('Connection timeout - is OpenClaw Gateway running?');
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
        console.log('[OpenClawClient] WebSocket opened');
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message, resolve, reject, timeout);
        } catch (error) {
          console.error('[OpenClawClient] Failed to parse message:', error);
        }
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        console.error('[OpenClawClient] WebSocket error:', error.message);
        // Don't reject here, let close event handle it
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        const wasConnected = this.connected;
        this.connected = false;

        console.log(`[OpenClawClient] WebSocket closed: ${code} ${reason || '(no reason)'}`);

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

      console.log('[OpenClawClient] ✅ Connected successfully');
      this.onConnect();
      connectResolve?.(message);
      return;
    }

    // Handle connect response (res with ok: true for connect method)
    if (message.type === 'res' && message.ok === true) {
      // Check if this is the connect response
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);

        // If payload looks like a hello-ok, treat it as connection success
        if (message.payload && !this.connected) {
          clearTimeout(timeout);
          this.connected = true;
          this.reconnectAttempts = 0;
          this.currentReconnectDelay = this.reconnectDelay;

          console.log('[OpenClawClient] ✅ Connected successfully');
          this.onConnect();
          connectResolve?.(message.payload);
          return;
        }

        pending.resolve(message.payload);
        return;
      }
    }

    // Handle regular events
    if (message.type === 'event') {
      this.eventListeners.forEach(listener => {
        try {
          listener(message);
        } catch (error) {
          console.error('[OpenClawClient] Event listener error:', error);
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[OpenClawClient] Cannot respond to challenge - no connection');
      return;
    }

    const nonce = challenge?.nonce || null;
    const role = 'operator';
    const scopes = ['operator.read', 'operator.admin', 'operator.approvals'];
    const signedAtMs = Date.now();
    const clientId = 'gateway-client';
    const clientMode = 'backend';

    // Build device auth
    let device = undefined;
    if (this.deviceIdentity) {
      const payload = buildDeviceAuthPayload({
        deviceId: this.deviceIdentity.deviceId,
        clientId,
        clientMode,
        role,
        scopes,
        signedAtMs,
        token: this.token ?? null,
        nonce
      });

      const signature = signDevicePayload(this.deviceIdentity.privateKeyPem, payload);

      device = {
        id: this.deviceIdentity.deviceId,
        publicKey: publicKeyRawBase64Url(this.deviceIdentity.publicKeyPem),
        signature,
        signedAt: signedAtMs,
        nonce
      };
    }

    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: clientId,
        displayName: 'GuardClaw Safety Monitor',
        version: '0.1.0',
        platform: process.platform || 'darwin',
        mode: clientMode,
        instanceId: `guardclaw-${this.deviceIdentity?.deviceId?.substring(0, 8) || 'default'}`
      },
      role,
      scopes,
      caps: [],
      commands: [],
      permissions: {},
      device
    };

    if (this.token) {
      params.auth = { token: this.token };
    }

    const id = `connect-${Date.now()}`;

    // Use the request mechanism so the response gets routed properly
    const requestMsg = {
      type: 'req',
      id,
      method: 'connect',
      params
    };

    // Register as pending request so the hello-ok response is captured
    this.pendingRequests.set(id, {
      resolve: () => {},
      reject: (err) => { console.error('[OpenClawClient] Connect rejected:', err.message); }
    });

    console.log('[OpenClawClient] Responding to challenge with device identity');
    this.ws.send(JSON.stringify(requestMsg));
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

    console.log(`[OpenClawClient] 🔄 Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})...`);
    this.onReconnecting(this.reconnectAttempts, delay);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      console.log(`[OpenClawClient] Attempting reconnect...`);

      try {
        await this.connect();
      } catch (error) {
        console.error('[OpenClawClient] Reconnect failed:', error.message);
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

    console.log('[OpenClawClient] Disconnected (intentional)');
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
