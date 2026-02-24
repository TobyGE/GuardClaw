import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SafeguardService } from '../safeguard.js';

export function configRoutes(deps) {
  const router = Router();
  const { getOpenclawClient, getSafeguardService, setSafeguardService } = deps;

  router.post('/api/config/token', async (req, res) => {
    const { token } = req.body;
    if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Invalid token' });

    try {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

      const tokenRegex = /^OPENCLAW_TOKEN=.*/m;
      if (tokenRegex.test(envContent)) {
        envContent = envContent.replace(tokenRegex, `OPENCLAW_TOKEN=${token}`);
      } else {
        envContent += `\nOPENCLAW_TOKEN=${token}\n`;
      }
      fs.writeFileSync(envPath, envContent, 'utf8');
      process.env.OPENCLAW_TOKEN = token;

      const openclawClient = getOpenclawClient();
      if (openclawClient) {
        openclawClient.token = token;
        console.log('[GuardClaw] Token updated, reconnecting...');
        openclawClient.disconnect();
        setTimeout(() => openclawClient.connect().catch(err => console.error('[GuardClaw] Reconnect failed:', err)), 1000);
      }
      res.json({ success: true, message: 'Token saved and reconnecting' });
    } catch (error) {
      console.error('[GuardClaw] Failed to save token:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/config/detect-token', async (_req, res) => {
    try {
      const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
      if (!fs.existsSync(configPath)) return res.status(404).json({ error: 'OpenClaw config not found' });
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const token = config?.gateway?.auth?.token;
      if (!token) return res.status(404).json({ error: 'Token not found in OpenClaw config' });
      res.json({ token, source: configPath });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/config/llm', async (req, res) => {
    const { backend, lmstudioUrl, lmstudioModel, ollamaUrl, ollamaModel } = req.body;
    if (!backend || !['lmstudio', 'ollama', 'anthropic'].includes(backend)) return res.status(400).json({ error: 'Invalid backend' });

    try {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      const updates = { SAFEGUARD_BACKEND: backend, LMSTUDIO_URL: lmstudioUrl, LMSTUDIO_MODEL: lmstudioModel, OLLAMA_URL: ollamaUrl, OLLAMA_MODEL: ollamaModel };

      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          const regex = new RegExp(`^${key}=.*`, 'm');
          envContent = regex.test(envContent) ? envContent.replace(regex, `${key}=${value}`) : envContent + `\n${key}=${value}\n`;
        }
      }
      fs.writeFileSync(envPath, envContent, 'utf8');
      process.env.SAFEGUARD_BACKEND = backend;
      if (lmstudioUrl) process.env.LMSTUDIO_URL = lmstudioUrl;
      if (lmstudioModel) process.env.LMSTUDIO_MODEL = lmstudioModel;
      if (ollamaUrl) process.env.OLLAMA_URL = ollamaUrl;
      if (ollamaModel) process.env.OLLAMA_MODEL = ollamaModel;

      const newSafeguard = new SafeguardService(process.env.ANTHROPIC_API_KEY, backend, { lmstudioUrl, lmstudioModel, ollamaUrl, ollamaModel });
      const testResult = await newSafeguard.testConnection();
      if (testResult.connected) {
        Object.assign(getSafeguardService(), newSafeguard);
        console.log('[GuardClaw] LLM config updated and applied');
        res.json({ success: true, message: 'LLM config saved and applied', testResult });
      } else {
        res.status(500).json({ error: 'Config saved but connection failed', testResult });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api/config/llm/test', async (req, res) => {
    const { backend, lmstudioUrl, lmstudioModel, ollamaUrl, ollamaModel } = req.body;
    if (!backend || !['lmstudio', 'ollama', 'anthropic'].includes(backend)) return res.status(400).json({ error: 'Invalid backend' });
    try {
      const testSafeguard = new SafeguardService(process.env.ANTHROPIC_API_KEY, backend, { lmstudioUrl, lmstudioModel, ollamaUrl, ollamaModel });
      res.json(await testSafeguard.testConnection());
    } catch (error) {
      res.status(500).json({ connected: false, error: error.message, message: `Test failed: ${error.message}` });
    }
  });

  router.post('/api/config/llm/models', async (req, res) => {
    const { backend, lmstudioUrl, ollamaUrl } = req.body;
    try {
      if (backend === 'lmstudio') {
        const url = (lmstudioUrl || 'http://127.0.0.1:1234/v1').replace(/\/$/, '');
        const resp = await fetch(`${url}/models`, { signal: AbortSignal.timeout(5000) });
        const data = await resp.json();
        return res.json({ models: (data.data || []).map(m => m.id).filter(id => !id.includes('embedding')) });
      }
      if (backend === 'ollama') {
        const url = (ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
        const resp = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
        const data = await resp.json();
        return res.json({ models: (data.models || []).map(m => m.name) });
      }
      res.json({ models: [] });
    } catch (error) {
      res.json({ models: [], error: error.message });
    }
  });

  router.post('/api/config/fail-closed', async (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
    deps.setFailClosed(enabled);
    console.log(`[GuardClaw] Fail-closed mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
    res.json({ success: true, failClosed: enabled });
  });

  return router;
}
