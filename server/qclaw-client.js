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
    console.warn('[QclawClient] Could not load device identity, generating new one:', err.message);
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

  console.log('[QclawClient] Generated new device identity:', identity.deviceId.substring(0, 16) + '...');
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

// ─── Qclaw Config Auto-Discovery ─────────────────────────────────────────────

function discoverQclawConfig() {
  // Qclaw stores its config at ~/.qclaw/openclaw.json (same filename, different dir)
  const configPath = path.join(os.homedir(), '.qclaw', 'openclaw.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(raw);
      const gateway = config?.gateway || {};
      return {
        url: `ws://127.0.0.1:${gateway.port || 28789}`,
        token: gateway.auth?.token || null
      };
    }
  } catch (err) {
    console.warn('[QclawClient] Could not read Qclaw config:', err.message);
  }
  return null;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class QclawClient {
  constructor(url, token, options = {}) {
    // Auto-discover Qclaw config if no token provided
    if (!token) {
      const discovered = discoverQclawConfig();
      if (discovered) {
        if (!url || url === 'ws://127.0.0.1:28789') {
          url = discovered.url;
        }
        if (discovered.token) {
          token = discovered.token;
          console.log('[QclawClient] Auto-discovered gateway token from ~/.qclaw/openclaw.json');
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
        settle(reject, new Error('Connection timeout - is Qclaw Gateway running?'));
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
        console.log('[QclawClient] WebSocket opened');
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message, (v) => settle(resolve, v), (e) => settle(reject, e));
        } catch (error) {
          console.error('[QclawClient] Failed to parse message:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('[QclawClient] WebSocket error:', error.message);
      });

      this.ws.on('close', (code, reason) => {
        const wasConnected = this.connected;
        this.connected = false;

        console.log(`[QclawClient] WebSocket closed: ${code} ${reason || '(no reason)'}`);

        if (wasConnected) {
          this.onDisconnect();
        } else {
          settle(reject, new Error(`Connection refused: ${code} ${reason || '(no reason)'}`));
        }

        if (!this.intentionalDisconnect) {
          this.scheduleReconnect();
        }
      });
    });
  }

  handleMessage(message, connectResolve, connectReject) {
    if (message.type === 'event' && message.event === 'connect.challenge') {
      this.handleChallenge(message.payload);
      return;
    }

    if (message.type === 'hello-ok' || (message.type === 'res' && message.payload?.type === 'hello-ok')) {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.currentReconnectDelay = this.reconnectDelay;
      console.log('[QclawClient] ✅ Connected successfully');
      this.onConnect();
      connectResolve?.(message);
      return;
    }

    if (message.type === 'res' && message.ok === true) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        clearTimeout(pending.timerId);

        if (message.payload && !this.connected) {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.currentReconnectDelay = this.reconnectDelay;
          console.log('[QclawClient] ✅ Connected successfully');
          this.onConnect();
          connectResolve?.(message.payload);
          return;
        }

        pending.resolve(message.payload);
        return;
      }
    }

    if (message.type === 'event') {
      this.eventListeners.forEach(listener => {
        try {
          listener(message);
        } catch (error) {
          console.error('[QclawClient] Event listener error:', error);
        }
      });
      return;
    }

    if (message.type === 'res') {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        clearTimeout(pending.timerId);
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
      console.error('[QclawClient] Cannot respond to challenge - no connection');
      return;
    }

    const nonce = challenge?.nonce || null;
    const role = 'operator';
    const scopes = ['operator.read', 'operator.admin', 'operator.approvals'];
    const signedAtMs = Date.now();
    const clientId = 'gateway-client';
    const clientMode = 'backend';

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
      caps: ['tool-events'],
      commands: [],
      permissions: {},
      device
    };

    if (this.token) {
      params.auth = { token: this.token };
    }

    const id = `connect-${Date.now()}`;

    const requestMsg = {
      type: 'req',
      id,
      method: 'connect',
      params
    };

    this.pendingRequests.set(id, {
      resolve: () => {},
      reject: (err) => { console.error('[QclawClient] Connect rejected:', err.message); }
    });

    console.log('[QclawClient] Responding to challenge with device identity');
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
      const timerId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);

      this.pendingRequests.set(id, { resolve, reject, timerId });
      this.ws.send(JSON.stringify(request));
    });
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

    console.log(`[QclawClient] 🔄 Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})...`);
    this.onReconnecting(this.reconnectAttempts, delay);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      console.log(`[QclawClient] Attempting reconnect...`);

      try {
        await this.connect();
      } catch (error) {
        console.error('[QclawClient] Reconnect failed:', error.message);
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
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timerId);
      pending.reject(new Error('Disconnected'));
    }
    this.pendingRequests.clear();

    console.log('[QclawClient] Disconnected (intentional)');
  }

  getConnectionStats() {
    const wsOpen = this.ws && this.ws.readyState === WebSocket.OPEN;
    return {
      connected: this.connected && wsOpen,
      reconnectAttempts: this.reconnectAttempts,
      autoReconnect: this.autoReconnect,
      pendingRequests: this.pendingRequests.size
    };
  }
}
