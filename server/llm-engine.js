/**
 * Built-in LLM engine — runs MLX models via mlx_lm.server subprocess.
 * Uses OpenAI-compatible API on localhost:8081.
 */
import { spawn, execFileSync } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GUARDCLAW_DIR = path.join(os.homedir(), '.guardclaw');
const MODELS_DIR = path.join(GUARDCLAW_DIR, 'models');
const VENV_DIR = path.join(GUARDCLAW_DIR, 'venv');
const VENV_PYTHON = path.join(VENV_DIR, 'bin', 'python3');
const MLX_PORT = 8081;

/**
 * Check for a bundled Python venv inside the .app bundle (GuardClawBar).
 * Layout: <app>/Contents/Resources/python-env/bin/python3
 * The backend runs from <app>/Contents/Resources/backend/, so __dirname is .../backend/server/
 */
function findBundledPython() {
  // __dirname → .../Contents/Resources/backend/server
  // bundled python → .../Contents/Resources/python-env/bin/python3
  const bundled = path.resolve(__dirname, '..', '..', 'python-env', 'bin', 'python3');
  console.log(`[LLMEngine] Checking bundled Python at: ${bundled}`);
  if (fs.existsSync(bundled)) {
    try {
      execFileSync(bundled, ['-c', 'import mlx_lm'], { timeout: 15000 });
      console.log(`[LLMEngine] Using bundled Python: ${bundled}`);
      return bundled;
    } catch (err) {
      console.log(`[LLMEngine] Bundled Python found but mlx-lm not working: ${err.message}`);
    }
  } else {
    console.log(`[LLMEngine] No bundled Python found at that path`);
  }
  return null;
}

/** Find a working Python 3.10+ on the system */
function findSystemPython() {
  const candidates = [
    '/opt/homebrew/opt/python@3.13/bin/python3.13',
    '/opt/homebrew/opt/python@3.12/bin/python3.12',
    '/opt/homebrew/opt/python@3.11/bin/python3.11',
    '/opt/homebrew/opt/python@3.10/bin/python3.10',
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    'python3',
  ];
  for (const py of candidates) {
    try {
      const version = execFileSync(py, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
      const match = version.match(/Python 3\.(\d+)/);
      if (match && parseInt(match[1]) >= 10) return py;
    } catch {}
  }
  return null;
}

// Resolved Python path — set once by ensureVenv(), used for all subprocess spawns
let resolvedPython = null;

/** Ensure a working Python with mlx-lm is available. Returns the python path. */
function ensureVenv() {
  // Already resolved?
  if (resolvedPython) {
    return resolvedPython;
  }

  // 1. Check bundled Python (inside .app)
  const bundled = findBundledPython();
  if (bundled) {
    resolvedPython = bundled;
    return bundled;
  }

  // 2. Check existing user venv
  if (fs.existsSync(VENV_PYTHON)) {
    try {
      execFileSync(VENV_PYTHON, ['-c', 'import mlx_lm'], { timeout: 10000 });
      resolvedPython = VENV_PYTHON;
      return VENV_PYTHON;
    } catch {} // mlx-lm not installed in existing venv, continue
  }

  // 3. Create new venv from system Python
  const sysPython = findSystemPython();
  if (!sysPython) {
    throw new Error('No Python 3.10+ found. Install Python via: brew install python@3.13');
  }

  console.log(`[LLMEngine] Setting up Python venv (using ${sysPython})...`);

  if (!fs.existsSync(GUARDCLAW_DIR)) {
    fs.mkdirSync(GUARDCLAW_DIR, { recursive: true });
  }

  // Create venv
  execFileSync(sysPython, ['-m', 'venv', VENV_DIR], { timeout: 30000 });

  // Upgrade pip first to avoid dependency resolver issues
  console.log('[LLMEngine] Upgrading pip...');
  try {
    execFileSync(VENV_PYTHON, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], {
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {}

  // Install mlx-lm
  console.log('[LLMEngine] Installing mlx-lm (this may take a minute)...');
  try {
    execFileSync(VENV_PYTHON, ['-m', 'pip', 'install', '--quiet', 'mlx-lm'], {
      timeout: 300000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // If install fails, try with --force-reinstall to resolve conflicts
    console.warn('[LLMEngine] Initial install failed, trying --force-reinstall...');
    try {
      execFileSync(VENV_PYTHON, ['-m', 'pip', 'install', '--quiet', '--force-reinstall', 'mlx-lm'], {
        timeout: 300000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (retryErr) {
      // Last resort: recreate venv from scratch
      console.warn('[LLMEngine] Force reinstall failed, recreating venv...');
      fs.rmSync(VENV_DIR, { recursive: true, force: true });
      execFileSync(sysPython, ['-m', 'venv', VENV_DIR], { timeout: 30000 });
      execFileSync(VENV_PYTHON, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], {
        timeout: 60000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      execFileSync(VENV_PYTHON, ['-m', 'pip', 'install', '--quiet', 'mlx-lm'], {
        timeout: 300000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
  }

  console.log('[LLMEngine] Python environment ready');
  resolvedPython = VENV_PYTHON;
  return VENV_PYTHON;
}

const MODEL_CATALOG = [
  {
    id: 'qwen3-4b',
    name: 'Qwen 3 4B',
    description: 'Best balance of speed and accuracy for security analysis',
    size: '2.5 GB',
    hfRepo: 'mlx-community/Qwen3-4B-Instruct-2507-4bit',
    recommended: true,
  },
];

class LLMEngine extends EventEmitter {
  constructor() {
    super();
    this._process = null;
    this._loadedModelId = null;
    this._serverModelId = null;
    this._downloading = new Map(); // modelId -> { progress, abortController }
    this._loadingModelId = null; // modelId currently being loaded
    this._statusMessage = null;  // human-readable status for UI
    this._setupError = null;     // last setup/download error for UI
    this._onTokenUsage = null; // callback(promptTokens, completionTokens)
  }

  get modelsDir() {
    return MODELS_DIR;
  }

  _ensureDir() {
    if (!fs.existsSync(MODELS_DIR)) {
      fs.mkdirSync(MODELS_DIR, { recursive: true });
    }
  }

  /** Ensure Python venv + mlx-lm are ready. Throws with user-friendly message if not. */
  _ensureVenv() {
    if (this._venvReady) return;
    ensureVenv();
    this._venvReady = true;
  }

  /** Get local path for a model */
  _modelPath(catalog) {
    return path.join(MODELS_DIR, catalog.hfRepo.replace('/', '--'));
  }

  /** Check if model is fully downloaded (config.json + safetensors weights) */
  _isDownloaded(catalog) {
    const dir = this._modelPath(catalog);
    if (!fs.existsSync(path.join(dir, 'config.json'))) return false;
    // Must have at least one .safetensors weight file
    try {
      const files = fs.readdirSync(dir);
      return files.some(f => f.endsWith('.safetensors'));
    } catch {
      return false;
    }
  }

  /** Check if download started but is incomplete (config.json exists but no weights) */
  _isIncomplete(catalog) {
    const dir = this._modelPath(catalog);
    if (!fs.existsSync(path.join(dir, 'config.json'))) return false;
    try {
      const files = fs.readdirSync(dir);
      return !files.some(f => f.endsWith('.safetensors'));
    } catch {
      return false;
    }
  }

  /** Get model catalog with download status */
  listModels() {
    this._ensureDir();
    return MODEL_CATALOG.map(m => {
      const downloaded = this._isDownloaded(m);
      const incomplete = this._isIncomplete(m);
      const downloading = this._downloading.has(m.id);
      const progress = downloading ? this._downloading.get(m.id).progress : 0;
      return {
        ...m,
        downloaded,
        incomplete,
        downloading,
        progress,
        loading: this._loadingModelId === m.id,
        loaded: this._loadedModelId === m.id,
        statusMessage: this._statusMessage,
        setupError: incomplete && !downloading ? 'Download incomplete — weights missing. Click Setup to re-download.' : this._setupError,
        filePath: downloaded ? this._modelPath(m) : null,
      };
    });
  }

  /** Download a model from HuggingFace using snapshot_download */
  async downloadModel(modelId) {
    const catalog = MODEL_CATALOG.find(m => m.id === modelId);
    if (!catalog) throw new Error(`Unknown model: ${modelId}`);
    if (this._downloading.has(modelId)) throw new Error(`Already downloading: ${modelId}`);

    this._ensureDir();
    this._setupError = null;
    const destPath = this._modelPath(catalog);

    if (this._isDownloaded(catalog)) {
      return { status: 'already_downloaded', path: destPath };
    }

    // Clean up incomplete download (has config.json but missing weights)
    if (this._isIncomplete(catalog)) {
      console.log(`[LLMEngine] Cleaning up incomplete download at ${destPath}`);
      fs.rmSync(destPath, { recursive: true, force: true });
    }

    this._statusMessage = 'Setting up Python environment...';
    try {
      this._ensureVenv();
    } catch (err) {
      this._statusMessage = null;
      this._setupError = err.message;
      throw err;
    }
    this._statusMessage = 'Starting download...';

    const state = { progress: 0, abortController: new AbortController() };
    this._downloading.set(modelId, state);
    this.emit('download-start', { modelId });

    return new Promise((resolve, reject) => {
      const pyScript = `
import sys, json, os
from huggingface_hub import snapshot_download

path = snapshot_download(
    os.environ["HF_REPO"],
    local_dir=os.environ["DEST_PATH"],
)
print(json.dumps({"done": True, "path": path}), flush=True)
`;
      const proc = spawn(resolvedPython, ['-u', '-c', pyScript], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HF_REPO: catalog.hfRepo, DEST_PATH: destPath },
      });

      if (state.abortController.signal.aborted) {
        proc.kill();
        this._downloading.delete(modelId);
        reject(new Error('Download cancelled'));
        return;
      }

      state.abortController.signal.addEventListener('abort', () => {
        proc.kill();
      });

      let stderr = '';
      let lastProgress = 0;

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        // Parse tqdm progress from stderr (e.g., "50%|...")
        const match = text.match(/(\d+)%\|/);
        if (match) {
          const pct = parseInt(match[1]);
          if (pct > lastProgress) {
            lastProgress = pct;
            state.progress = pct;
            this._statusMessage = `Downloading model... ${pct}%`;
            this.emit('download-progress', { modelId, progress: pct });
          }
        }
      });

      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString().trim();
        try {
          const data = JSON.parse(text);
          if (data.done) {
            state.progress = 100;
            this.emit('download-progress', { modelId, progress: 100 });
          }
        } catch {}
      });

      proc.on('close', (code) => {
        this._downloading.delete(modelId);
        if (code === 0 && this._isDownloaded(catalog)) {
          this._statusMessage = null;
          this.emit('download-complete', { modelId, path: destPath });
          resolve({ status: 'downloaded', path: destPath });
        } else {
          this._statusMessage = null;
          const err = new Error(`Download failed (code ${code}): ${stderr.slice(-500)}`);
          this._setupError = err.message;
          this.emit('download-error', { modelId, error: err.message });
          reject(err);
        }
      });
    });
  }

  /** Download and load a model in one step */
  async setupAndLoad(modelId) {
    const catalog = MODEL_CATALOG.find(m => m.id === modelId);
    if (!catalog) throw new Error(`Unknown model: ${modelId}`);

    if (!this._isDownloaded(catalog)) {
      await this.downloadModel(modelId);
    }
    return this.loadModel(modelId);
  }

  /** Cancel an ongoing download */
  cancelDownload(modelId) {
    const state = this._downloading.get(modelId);
    if (state) {
      state.abortController.abort();
      this._downloading.delete(modelId);
    }
  }

  /** Delete a downloaded model */
  deleteModel(modelId) {
    const catalog = MODEL_CATALOG.find(m => m.id === modelId);
    if (!catalog) throw new Error(`Unknown model: ${modelId}`);

    if (this._loadedModelId === modelId) {
      this.unload();
    }

    const dir = this._modelPath(catalog);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }
  }

  /** Wait for mlx_lm.server to be ready by polling the health endpoint */
  async _waitForServer(timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await new Promise((resolve, reject) => {
          const req = http.request(
            { hostname: '127.0.0.1', port: MLX_PORT, path: '/v1/models', method: 'GET', timeout: 2000 },
            (res) => {
              let body = '';
              res.on('data', (d) => body += d);
              res.on('end', () => resolve(body));
            }
          );
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
          req.end();
        });
        return true;
      } catch {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    throw new Error('mlx_lm.server did not become ready within timeout');
  }

  /** Load a model by starting mlx_lm.server subprocess */
  async loadModel(modelId) {
    const catalog = MODEL_CATALOG.find(m => m.id === modelId);
    if (!catalog) throw new Error(`Unknown model: ${modelId}`);

    const modelPath = this._modelPath(catalog);
    if (!this._isDownloaded(catalog)) {
      throw new Error(`Model not downloaded: ${modelId}`);
    }

    this._loadingModelId = modelId;
    this._setupError = null;
    this._statusMessage = 'Setting up Python environment...';

    try {
      this._ensureVenv();

      // Unload previous model
      if (this._process) {
        this._statusMessage = 'Unloading previous model...';
        await this.unload();
      }

      // Kill any stale process on MLX_PORT before starting
      try {
        const pids = execFileSync('lsof', ['-ti', `:${MLX_PORT}`], { encoding: 'utf8', timeout: 5000 }).trim();
        if (pids) {
          for (const pid of pids.split('\n')) {
            try { process.kill(parseInt(pid), 'SIGKILL'); } catch {}
          }
          console.log(`[LLMEngine] Killed stale process(es) on port ${MLX_PORT}: ${pids}`);
          await new Promise(r => setTimeout(r, 500));
        }
      } catch {}

      this._statusMessage = 'Starting model server...';
      console.log(`[LLMEngine] Starting mlx_lm.server with model: ${catalog.name}...`);

      this._process = spawn(resolvedPython, [
        '-m', 'mlx_lm', 'server',
        '--model', modelPath,
        '--port', String(MLX_PORT),
        '--decode-concurrency', '4',
        '--prompt-concurrency', '4',
        '--chat-template-args', '{"enable_thinking":false}',
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this._process.stdout.on('data', (chunk) => {
        console.log(`[mlx_lm] ${chunk.toString().trimEnd()}`);
      });
      this._process.stderr.on('data', (chunk) => {
        console.log(`[mlx_lm] ${chunk.toString().trimEnd()}`);
      });

      this._process.on('close', (code) => {
        console.log(`[LLMEngine] mlx_lm.server exited (code ${code})`);
        if (this._loadedModelId === modelId) {
          this._process = null;
          this._loadedModelId = null;
        }
      });

      this._statusMessage = 'Loading model into memory...';
      await this._waitForServer();

      this._loadedModelId = modelId;
      this._loadingModelId = null;
      this._statusMessage = null;
      console.log(`[LLMEngine] Model loaded: ${catalog.name}`);

      return { status: 'loaded', modelId };
    } catch (err) {
      this._loadingModelId = null;
      this._statusMessage = null;
      this._setupError = err.message;
      throw err;
    }
  }

  /** Unload current model by killing the subprocess */
  async unload() {
    if (this._process) {
      this._process.kill('SIGTERM');
      // Give it a moment to shut down
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (this._process) this._process.kill('SIGKILL');
          resolve();
        }, 3000);
        this._process.on('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      this._process = null;
    }
    this._loadedModelId = null;
    this._serverModelId = null;
    console.log('[LLMEngine] Model unloaded');
  }

  /** Check if a model is loaded and ready */
  get isReady() {
    return this._process !== null && this._loadedModelId !== null;
  }

  get loadedModelId() {
    return this._loadedModelId;
  }

  /** Query /v1/models to get the actual model ID reported by mlx_lm.server */
  async _getServerModelId() {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: MLX_PORT, path: '/v1/models', method: 'GET', timeout: 5000 },
        (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              resolve(json.data?.[0]?.id || 'default');
            } catch { resolve('default'); }
          });
        }
      );
      req.on('error', () => resolve('default'));
      req.on('timeout', () => { req.destroy(); resolve('default'); });
      req.end();
    });
  }

  /** Run a chat completion via mlx_lm.server OpenAI-compatible endpoint */
  async chatCompletion({ messages, temperature = 0.3, maxTokens = 800, stop }) {
    if (!this.isReady) {
      throw new Error('No model loaded');
    }

    // mlx_lm.server uses the full model path as its model ID
    if (!this._serverModelId) {
      this._serverModelId = await this._getServerModelId();
    }

    const payload = {
      model: this._serverModelId,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (stop) payload.stop = stop;
    const body = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: MLX_PORT,
          path: '/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 60000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (res.statusCode >= 400) {
                reject(new Error(`MLX server error ${res.statusCode}: ${data}`));
              } else {
                // Track token usage
                if (json.usage && this._onTokenUsage) {
                  this._onTokenUsage(json.usage.prompt_tokens || 0, json.usage.completion_tokens || 0);
                }
                resolve(json);
              }
            } catch (e) {
              reject(new Error(`Failed to parse MLX response: ${data}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('MLX inference timeout')); });
      req.write(body);
      req.end();
    });
  }
}

// Singleton
const engine = new LLMEngine();
export default engine;
export { MODEL_CATALOG };
