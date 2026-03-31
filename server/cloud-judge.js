/**
 * CloudJudge — optional Stage 2 judge using external closed-source LLMs.
 *
 * Called when local model returns WARNING or BLOCK (riskScore >= 4).
 * Content is PII-masked before sending.
 *
 * Supported providers:
 *   - gemini  : Google Gemini via OAuth (PKCE) or API key
 *   - claude  : Anthropic via OAuth (PKCE, same flow as Claude Code) or API key
 *   - openai  : OpenAI via OAuth (PKCE) or API key
 *   - custom  : any OpenAI-compatible endpoint with API key
 *
 * OAuth tokens stored in: ~/.guardclaw/oauth-tokens.json
 */

import { maskPII } from './pii-detector.js';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import os from 'os';

// ─── Provider configs ────────────────────────────────────────────────────────

const PROVIDERS = {
  // Claude: OAuth via same PKCE flow as Claude Code CLI (production client)
  claude: {
    displayName: 'Anthropic Claude',
    authURL: 'https://claude.com/cai/oauth/authorize',
    tokenURL: 'https://platform.claude.com/v1/oauth/token',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    scopes: ['org:create_api_key', 'user:profile', 'user:inference', 'user:sessions:claude_code'],
    baseURL: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-haiku-4-5-20251001',
    oauthSupported: true,
  },
  // Gemini & OpenAI: API key only (no public OAuth client)
  gemini: {
    displayName: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    oauthSupported: false,
  },
  openai: {
    displayName: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    oauthSupported: false,
  },
};

// ─── Config persistence ───────────────────────────────────────────────────────

const CONFIG_FILE = path.join(os.homedir(), '.guardclaw', 'cloud-judge-config.json');

function loadPersistedConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function savePersistedConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

// ─── Token storage ───────────────────────────────────────────────────────────

const TOKEN_FILE = path.join(os.homedir(), '.guardclaw', 'oauth-tokens.json');

function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveTokens(tokens) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

function getToken(provider) {
  const tokens = loadTokens();
  const t = tokens[provider];
  if (!t) return null;
  // Refresh token check: just return stored token (refresh on 401)
  return t;
}

function setToken(provider, tokenData) {
  const tokens = loadTokens();
  tokens[provider] = {
    ...tokenData,
    savedAt: Date.now(),
  };
  saveTokens(tokens);
}

function clearToken(provider) {
  const tokens = loadTokens();
  delete tokens[provider];
  saveTokens(tokens);
}

// ─── PKCE helpers ────────────────────────────────────────────────────────────

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

// ─── Local callback server ───────────────────────────────────────────────────

const CALLBACK_PORT = 54321;
const CALLBACK_PATH = '/callback';
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

/**
 * Start a temporary local HTTP server to receive the OAuth callback.
 * Resolves with { code, state } or rejects on timeout.
 */
function waitForCallback(timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404);
        res.end();
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:system-ui;text-align:center;padding:60px">
        <h2>${error ? '❌ Authorization failed' : '✅ Connected!'}</h2>
        <p>${error ? error : 'You can close this tab and return to GuardClaw.'}</p>
        <script>window.close()</script>
      </body></html>`);

      server.close();
      if (error) reject(new Error(`OAuth error: ${error}`));
      else resolve({ code, state });
    });

    server.listen(CALLBACK_PORT, () => {
      console.log(`[CloudJudge] OAuth callback server listening on port ${CALLBACK_PORT}`);
    });

    setTimeout(() => {
      server.close();
      reject(new Error('OAuth timeout: user did not complete authorization within 2 minutes'));
    }, timeoutMs);
  });
}

// ─── Token exchange ──────────────────────────────────────────────────────────

async function exchangeCode(provider, code, verifier, state) {
  const cfg = PROVIDERS[provider];
  const resp = await fetch(cfg.tokenURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: cfg.clientId,
      code_verifier: verifier,
      state,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Token exchange failed ${resp.status}: ${err.substring(0, 200)}`);
  }

  return resp.json();
}

async function refreshAccessToken(provider, refreshToken) {
  const cfg = PROVIDERS[provider];
  const resp = await fetch(cfg.tokenURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: cfg.clientId,
    }),
  });

  if (!resp.ok) throw new Error(`Token refresh failed: ${resp.status}`);
  return resp.json();
}

// ─── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a security judge for AI coding agent tool calls. Classify each action as SAFE, WARNING, or BLOCK.

BLOCK: rm -rf on non-project paths, sudo, curl|bash, writing to .ssh/.bashrc/.zshrc, exfiltrating secrets, reverse shells, force-pushing to main/master, production deploys without dry-run
WARNING: curl POST to external URLs, kill/pkill, mass deletions within project, reading sensitive config files, agent spawning with broad permissions
SAFE: read-only commands, project-scoped file writes/edits, git operations (non-destructive), npm/pip installs from manifest, web search/fetch

Note: PII in the input has been masked. Focus on the action's security implications.

Output ONLY valid JSON: {"verdict":"SAFE|WARNING|BLOCK","reason":"1-2 sentences"}`;

// ─── CloudJudge class ─────────────────────────────────────────────────────────

export class CloudJudge {
  constructor(config = {}) {
    const persisted = loadPersistedConfig();
    this.enabled = config.enabled ?? persisted.enabled ?? (process.env.CLOUD_JUDGE_ENABLED === 'true');
    this.provider = config.provider ?? persisted.provider ?? process.env.CLOUD_JUDGE_PROVIDER ?? 'claude';
    this.apiKey = config.apiKey ?? persisted.apiKey ?? process.env.CLOUD_JUDGE_API_KEY ?? '';
    this.model = config.model ?? persisted.model ?? process.env.CLOUD_JUDGE_MODEL ?? '';
    this.baseURL = config.baseURL ?? persisted.baseURL ?? process.env.CLOUD_JUDGE_BASE_URL ?? '';
    // Judge mode: 'mixed' | 'local-only' | 'cloud-only'
    this.judgeMode = config.judgeMode ?? persisted.judgeMode ?? 'mixed';

    const defaults = PROVIDERS[this.provider] ?? {};
    if (!this.model) this.model = defaults.defaultModel ?? 'default';
    if (!this.baseURL) this.baseURL = defaults.baseURL ?? '';
  }

  get isConfigured() {
    if (!this.enabled) return false;
    if (this.apiKey) return true;
    if (PROVIDERS[this.provider]) return !!getToken(this.provider);
    return false;
  }

  get isOAuthConnected() {
    return !!getToken(this.provider);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Start OAuth PKCE flow. Opens browser, waits for callback, stores token.
   * Returns { ok: true } or throws.
   */
  async startOAuth(provider = this.provider) {
    const cfg = PROVIDERS[provider];
    if (!cfg) throw new Error(`Unknown provider: ${provider}`);
    if (!cfg.oauthSupported) throw new Error(`${cfg.displayName} does not support OAuth — use an API key instead`);

    const { verifier, challenge } = generatePKCE();
    const state = generateState();

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: REDIRECT_URI,
      scope: cfg.scopes.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });

    const authURL = `${cfg.authURL}?${params}`;
    console.log(`[CloudJudge] Opening browser for ${cfg.displayName} OAuth...`);
    console.log(`[CloudJudge] URL: ${authURL}`);

    // Open browser
    const { exec } = await import('child_process');
    exec(`open "${authURL}"`);

    // Wait for callback
    const { code, state: returnedState } = await waitForCallback();
    if (returnedState !== state) throw new Error('OAuth state mismatch (possible CSRF)');
    console.log(`[CloudJudge] Callback received, exchanging code...`);

    // Exchange code for tokens
    let tokenData;
    try {
      tokenData = await exchangeCode(provider, code, verifier, state);
      console.log(`[CloudJudge] Token exchange OK, keys: ${Object.keys(tokenData).join(',')}`);
    } catch (err) {
      console.error(`[CloudJudge] Token exchange FAILED:`, err.message);
      throw err;
    }
    setToken(provider, tokenData);

    // For Claude: exchange OAuth token for API key
    if (provider === 'claude' && tokenData.access_token) {
      await this._claudeCreateApiKey(tokenData.access_token);
    }

    console.log(`[CloudJudge] ${cfg.displayName} OAuth connected successfully`);
    return { ok: true, provider };
  }

  /**
   * Disconnect OAuth for a provider.
   */
  disconnect(provider = this.provider) {
    clearToken(provider);
    if (provider === this.provider) this.apiKey = '';
  }

  /**
   * Analyze a prompt with the cloud judge.
   * Automatically masks PII before sending.
   */
  async analyze(rawPrompt, action) {
    if (!this.isConfigured) return null;

    const { masked, detected } = maskPII(rawPrompt);
    const piiNote = detected.length > 0
      ? `\n[PII masked: ${detected.join(', ')}]`
      : '';

    try {
      const text = await this._callProvider(masked + piiNote);
      if (!text) return null;

      const result = this._parseResponse(text);
      result.backend = `cloud:${this.provider}`;
      result.piiDetected = detected;
      result.cloudModel = this.model;
      result._rawResponse = text;
      result._userPrompt = masked;
      result._model = this.model;
      result._systemPrompt = SYSTEM_PROMPT;
      return result;
    } catch (err) {
      // On 401, try token refresh once
      if (err.message.includes('401') && getToken(this.provider)?.refresh_token) {
        try {
          const t = getToken(this.provider);
          const refreshed = await refreshAccessToken(this.provider, t.refresh_token);
          setToken(this.provider, { ...t, ...refreshed });
          const text = await this._callProvider(masked + piiNote);
          if (!text) return null;
          const result = this._parseResponse(text);
          result.backend = `cloud:${this.provider}`;
          result.piiDetected = detected;
          result.cloudModel = this.model;
          result._rawResponse = text;
          result._userPrompt = masked;
          result._model = this.model;
          result._systemPrompt = SYSTEM_PROMPT;
          return result;
        } catch (refreshErr) {
          console.error(`[CloudJudge] Token refresh failed:`, refreshErr.message);
          clearToken(this.provider);
        }
      }
      console.error(`[CloudJudge] ${this.provider} call failed:`, err.message);
      return null;
    }
  }

  // ─── Provider dispatch ───────────────────────────────────────────────────────

  async _callProvider(userContent) {
    const cfg = PROVIDERS[this.provider];

    // API key path
    if (this.apiKey) {
      if (this.provider === 'claude') return this._callClaudeApiKey(userContent);
      return this._callOpenAICompat(userContent, this.apiKey, this.baseURL || cfg?.baseURL);
    }

    // OAuth token path
    const token = getToken(this.provider);
    if (!token) throw new Error(`No credentials for ${this.provider}`);
    const accessToken = token.access_token;

    if (this.provider === 'claude') {
      // Prefer stored API key; fall back to Bearer token (user:inference scope)
      const storedKey = token._apiKey;
      if (storedKey) return this._callClaudeApiKey(userContent, storedKey);
      return this._callClaudeBearer(userContent, accessToken);
    }

    return this._callOpenAICompat(userContent, accessToken, cfg.baseURL);
  }

  // ─── Claude Bearer token (OAuth access_token with user:inference scope) ────────

  async _callClaudeBearer(userContent, accessToken) {
    const resp = await fetch(`${PROVIDERS.claude.baseURL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
      },
      body: JSON.stringify({
        model: this.model || PROVIDERS.claude.defaultModel,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Claude Bearer ${resp.status}: ${err.substring(0, 500)}`);
    }

    const data = await resp.json();
    return data.content?.[0]?.text ?? null;
  }

  // ─── Claude API key exchange (OAuth → API key) ───────────────────────────────

  async _claudeCreateApiKey(accessToken) {
    try {
      const resp = await fetch('https://api.anthropic.com/api/oauth/claude_cli/create_api_key', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ name: 'GuardClaw Cloud Judge' }),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.api_key) {
        const tokens = loadTokens();
        if (tokens.claude) {
          tokens.claude._apiKey = data.api_key;
          saveTokens(tokens);
        }
      }
    } catch (e) {
      console.warn('[CloudJudge] Could not create API key from OAuth:', e.message);
    }
  }

  // ─── Claude (Anthropic messages API) ─────────────────────────────────────────

  async _callClaudeApiKey(userContent, key) {
    const apiKey = key || this.apiKey;
    const resp = await fetch(`${PROVIDERS.claude.baseURL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model || PROVIDERS.claude.defaultModel,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Claude API ${resp.status}: ${err.substring(0, 200)}`);
    }

    const data = await resp.json();
    return data.content?.[0]?.text ?? null;
  }

  // ─── OpenAI-compatible (Gemini, OpenAI, custom) ──────────────────────────────

  async _callOpenAICompat(userContent, token, baseURL) {
    const url = `${baseURL}/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0,
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`${resp.status}: ${err.substring(0, 200)}`);
    }

    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? null;
  }

  // ─── Response parsing ────────────────────────────────────────────────────────

  _parseResponse(text) {
    let clean = text.trim()
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/gi, '');

    const first = clean.indexOf('{');
    const last = clean.lastIndexOf('}');
    if (first !== -1 && last > first) clean = clean.substring(first, last + 1);

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const v = /\b(SAFE|WARNING|BLOCK)\b/i.exec(text)?.[1]?.toUpperCase() ?? 'WARNING';
      parsed = { verdict: v, reason: text.substring(0, 200) };
    }

    const verdict = String(parsed.verdict ?? 'WARNING').toUpperCase().trim();
    const VERDICT_MAP = {
      SAFE:    { riskScore: 2, category: 'safe',      allowed: true  },
      WARNING: { riskScore: 5, category: 'warning',   allowed: true  },
      BLOCK:   { riskScore: 9, category: 'dangerous', allowed: false },
    };
    const mapped = VERDICT_MAP[verdict] ?? VERDICT_MAP.WARNING;

    return {
      ...mapped,
      reasoning: String(parsed.reason ?? parsed.reasoning ?? 'No reason provided'),
      warnings: [],
      verdict,
    };
  }

  // ─── Config helpers ──────────────────────────────────────────────────────────

  getConfig() {
    const connections = {};
    for (const p of Object.keys(PROVIDERS)) {
      const t = getToken(p);
      connections[p] = {
        connected: !!t,
        hasApiKey: p === this.provider && !!this.apiKey,
        displayName: PROVIDERS[p].displayName,
        defaultModel: PROVIDERS[p].defaultModel,
      };
    }
    return {
      enabled: this.enabled,
      provider: this.provider,
      model: this.model,
      baseURL: this.baseURL,
      isConfigured: this.isConfigured,
      judgeMode: this.judgeMode,
      connections,
    };
  }

  updateConfig(updates) {
    if (updates.enabled !== undefined) this.enabled = !!updates.enabled;
    if (updates.provider && PROVIDERS[updates.provider]) {
      this.provider = updates.provider;
      const cfg = PROVIDERS[this.provider];
      if (!updates.model) this.model = cfg.defaultModel;
      if (!updates.baseURL) this.baseURL = cfg.baseURL;
    }
    if (updates.apiKey !== undefined) this.apiKey = updates.apiKey;
    if (updates.model) this.model = updates.model;
    if (updates.baseURL) this.baseURL = updates.baseURL;
    if (updates.judgeMode && ['mixed', 'local-only', 'cloud-only'].includes(updates.judgeMode)) {
      this.judgeMode = updates.judgeMode;
    }

    // Persist to disk
    savePersistedConfig({
      enabled: this.enabled,
      provider: this.provider,
      model: this.model,
      apiKey: this.apiKey,
      judgeMode: this.judgeMode,
    });
  }

  /**
   * List supported providers with their connection status.
   */
  static getProviders() {
    const tokens = loadTokens();
    return Object.entries(PROVIDERS).map(([id, cfg]) => ({
      id,
      displayName: cfg.displayName,
      defaultModel: cfg.defaultModel,
      connected: !!tokens[id],
      oauthSupported: cfg.oauthSupported ?? false,
    }));
  }
}

// Singleton
export const cloudJudge = new CloudJudge();
