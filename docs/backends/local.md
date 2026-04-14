# Local Backends

Local backends run entirely on your machine. No API key required, no data leaves your system.

## LM Studio {#lm-studio}

[LM Studio](https://lmstudio.ai) is the recommended local backend for most users. Download models through its GUI, then GuardClaw connects to its built-in OpenAI-compatible server.

### Setup

1. Download and install [LM Studio](https://lmstudio.ai)
2. Download a model (recommended: `qwen/qwen3-4b` or `qwen2.5-7b-instruct`)
3. Go to **Local Server** tab → click **Start Server**
4. In GuardClaw:

```bash
guardclaw config set SAFEGUARD_BACKEND lmstudio
guardclaw config set LMSTUDIO_URL http://localhost:1234/v1
guardclaw config set LMSTUDIO_MODEL auto
```

Setting `LMSTUDIO_MODEL=auto` makes GuardClaw use whichever model is currently loaded in LM Studio.

### Recommended Models

| Model | Size | Accuracy | Speed |
|-------|------|----------|-------|
| `qwen/qwen3-4b-2507` | 4B | ⭐⭐⭐⭐⭐ | ⚡⚡⚡⚡ |
| `qwen2.5-7b-instruct` | 7B | ⭐⭐⭐⭐⭐ | ⚡⚡⚡ |
| `mistral-7b-instruct-v0.2` | 7B | ⭐⭐⭐⭐⭐ | ⚡⚡⚡ |
| `llama-3.1-8b-instruct` | 8B | ⭐⭐⭐⭐⭐ | ⚡⚡⚡ |
| `phi-3-mini-4k` | 3B | ⭐⭐⭐⭐ | ⚡⚡⚡⚡ |

Avoid models under 3B — they struggle to produce reliable JSON output.

### Using LM Studio as an OpenAI-compatible Endpoint

LM Studio can also serve as a proxy for any OpenAI-compatible API. Set `LMSTUDIO_API_KEY` if your endpoint requires auth:

```bash
guardclaw config set LMSTUDIO_API_KEY your-api-key
```

### Troubleshooting

See the full [LM Studio Troubleshooting guide](/LMSTUDIO-TROUBLESHOOTING).

---

## Ollama {#ollama}

[Ollama](https://ollama.ai) is ideal for Linux, Docker, and headless environments.

### Setup

1. Install [Ollama](https://ollama.ai)
2. Pull a model:
   ```bash
   ollama pull qwen2.5:7b
   ```
3. Configure GuardClaw:

```bash
guardclaw config set SAFEGUARD_BACKEND ollama
guardclaw config set OLLAMA_URL http://localhost:11434
guardclaw config set OLLAMA_MODEL qwen2.5:7b
```

### Running Ollama

Ollama must be running before GuardClaw starts:

```bash
ollama serve   # starts the server
```

Or install as a system service — see [Ollama docs](https://github.com/ollama/ollama).
