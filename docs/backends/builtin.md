# Built-in MLX Backend

The built-in backend downloads and runs an LLM directly inside GuardClaw — no LM Studio or Ollama needed. Uses Apple Silicon MLX for fast, efficient inference.

**Requires:** macOS with Apple Silicon (M1/M2/M3/M4).

## Setup

The setup wizard can configure this automatically. Or manually:

```bash
guardclaw config set SAFEGUARD_BACKEND built-in
```

On first use, GuardClaw will prompt you to download a model. Models are stored at `~/.guardclaw/models/`.

## Model Management

```bash
guardclaw config llm   # interactive model picker (download, load, unload)
```

Or via the dashboard **Settings → Model** panel:
- Browse available models
- Download with progress bar
- Load / unload with one click

## How It Works

GuardClaw spawns `mlx_lm.server` on port 8081 using a Python venv at `~/.guardclaw/venv/`. The venv is created automatically on first use.

The model file (~2–4 GB) is downloaded once and cached at `~/.guardclaw/models/`.

## Disk Usage

| Path | Contents |
|------|----------|
| `~/.guardclaw/venv/` | Python venv + mlx_lm (~500 MB) |
| `~/.guardclaw/models/` | Downloaded model weights (2–4 GB each) |

To free space:
```bash
guardclaw config llm   # → unload / delete model
```
