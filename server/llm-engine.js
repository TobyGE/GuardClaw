/**
 * Built-in LLM engine — runs GGUF models directly via node-llama-cpp.
 * No external LM Studio / Ollama dependency needed.
 */
import { getLlama, LlamaChatSession, resolveModelFile } from 'node-llama-cpp';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import os from 'os';

const MODELS_DIR = path.join(os.homedir(), '.guardclaw', 'models');

// Curated model list (small, fast, good at structured JSON output)
const MODEL_CATALOG = [
  {
    id: 'qwen3-4b',
    name: 'Qwen 3 4B',
    description: 'Best balance of speed and accuracy for security analysis',
    size: '2.7 GB',
    hfRepo: 'unsloth/Qwen3-4B-GGUF',
    hfFile: 'Qwen3-4B-Q4_K_M.gguf',
    recommended: true,
  },
  {
    id: 'qwen2.5-3b',
    name: 'Qwen 2.5 3B',
    description: 'Smaller and faster, good for low-memory systems',
    size: '2.0 GB',
    hfRepo: 'Qwen/Qwen2.5-3B-Instruct-GGUF',
    hfFile: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    recommended: false,
  },
  {
    id: 'qwen3-1.7b',
    name: 'Qwen 3 1.7B',
    description: 'Ultra-light, runs on any machine',
    size: '1.1 GB',
    hfRepo: 'unsloth/Qwen3-1.7B-GGUF',
    hfFile: 'Qwen3-1.7B-Q4_K_M.gguf',
    recommended: false,
  },
];

class LLMEngine extends EventEmitter {
  constructor() {
    super();
    this._llama = null;
    this._model = null;
    this._context = null;
    this._loadedModelId = null;
    this._downloading = new Map(); // modelId -> { progress, abortController }
  }

  get modelsDir() {
    return MODELS_DIR;
  }

  /** Ensure models directory exists */
  _ensureDir() {
    if (!fs.existsSync(MODELS_DIR)) {
      fs.mkdirSync(MODELS_DIR, { recursive: true });
    }
  }

  /** Get model catalog with download status */
  listModels() {
    this._ensureDir();
    return MODEL_CATALOG.map(m => {
      const filePath = path.join(MODELS_DIR, m.hfFile);
      const downloaded = fs.existsSync(filePath);
      const downloading = this._downloading.has(m.id);
      const progress = downloading ? this._downloading.get(m.id).progress : 0;
      return {
        ...m,
        downloaded,
        downloading,
        progress,
        loaded: this._loadedModelId === m.id,
        filePath: downloaded ? filePath : null,
      };
    });
  }

  /** Download a model from HuggingFace */
  async downloadModel(modelId) {
    const catalog = MODEL_CATALOG.find(m => m.id === modelId);
    if (!catalog) throw new Error(`Unknown model: ${modelId}`);
    if (this._downloading.has(modelId)) throw new Error(`Already downloading: ${modelId}`);

    this._ensureDir();
    const destPath = path.join(MODELS_DIR, catalog.hfFile);

    if (fs.existsSync(destPath)) {
      return { status: 'already_downloaded', path: destPath };
    }

    const state = { progress: 0, abortController: new AbortController() };
    this._downloading.set(modelId, state);
    this.emit('download-start', { modelId });

    try {
      const modelPath = await resolveModelFile(
        `hf:${catalog.hfRepo}/${catalog.hfFile}`,
        {
          directory: MODELS_DIR,
          signal: state.abortController.signal,
          onProgress: ({ downloadedSize, totalSize }) => {
            if (totalSize > 0) {
              state.progress = Math.round((downloadedSize / totalSize) * 100);
              this.emit('download-progress', { modelId, progress: state.progress });
            }
          },
        }
      );
      this._downloading.delete(modelId);
      this.emit('download-complete', { modelId, path: modelPath });
      return { status: 'downloaded', path: modelPath };
    } catch (err) {
      this._downloading.delete(modelId);
      this.emit('download-error', { modelId, error: err.message });
      throw err;
    }
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

    const filePath = path.join(MODELS_DIR, catalog.hfFile);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /** Load a model into memory */
  async loadModel(modelId) {
    const catalog = MODEL_CATALOG.find(m => m.id === modelId);
    if (!catalog) throw new Error(`Unknown model: ${modelId}`);

    const filePath = path.join(MODELS_DIR, catalog.hfFile);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Model not downloaded: ${modelId}`);
    }

    // Unload previous model
    if (this._model) {
      await this.unload();
    }

    if (!this._llama) {
      this._llama = await getLlama();
    }

    console.log(`[LLMEngine] Loading model: ${catalog.name}...`);
    this._model = await this._llama.loadModel({ modelPath: filePath });
    this._context = await this._model.createContext();
    this._loadedModelId = modelId;
    console.log(`[LLMEngine] Model loaded: ${catalog.name}`);

    return { status: 'loaded', modelId };
  }

  /** Unload current model */
  async unload() {
    if (this._context) {
      await this._context.dispose();
      this._context = null;
    }
    if (this._model) {
      await this._model.dispose();
      this._model = null;
    }
    this._loadedModelId = null;
    console.log('[LLMEngine] Model unloaded');
  }

  /** Check if a model is loaded and ready */
  get isReady() {
    return this._model !== null && this._context !== null;
  }

  get loadedModelId() {
    return this._loadedModelId;
  }

  /** Run a chat completion (OpenAI-compatible interface) */
  async chatCompletion({ messages, temperature = 0.3, maxTokens = 800 }) {
    if (!this.isReady) {
      throw new Error('No model loaded');
    }

    const session = new LlamaChatSession({
      contextSequence: this._context.getSequence(),
    });

    try {
      // Build prompt from messages
      const systemMsg = messages.find(m => m.role === 'system')?.content || '';
      const userMsg = messages.find(m => m.role === 'user')?.content || '';
      const prompt = systemMsg ? `${systemMsg}\n\n${userMsg}` : userMsg;

      const response = await session.prompt(prompt, {
        temperature,
        maxTokens,
      });

      return {
        choices: [{
          message: { role: 'assistant', content: response },
        }],
      };
    } finally {
      session.dispose();
    }
  }
}

// Singleton
const engine = new LLMEngine();
export default engine;
export { MODEL_CATALOG };
