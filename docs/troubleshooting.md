# Troubleshooting

## LM Studio Issues

### API returns 400

The model isn't loaded or is too small to produce valid JSON output.

**Fix:** Load a recommended model (qwen3-4b, mistral-7b, llama-3.1-8b) in LM Studio's **Local Server** tab, then click **Load Model**.

Avoid models under 3B — they can't reliably produce the JSON format GuardClaw needs.

### JSON parse failure

```
Failed to parse response: Unexpected token '<'
```

The model output `<think>` tags instead of JSON. Use a model with `SAFEGUARD_BACKEND=lmstudio` and temperature 0.1.

Or switch to the `fallback` backend temporarily:
```bash
guardclaw config set SAFEGUARD_BACKEND fallback
```

### "No models loaded"

In LM Studio: click the model name → **Load Model** → wait for green **Loaded** status.

### Analysis is slow (5-10s per call)

- Enable GPU acceleration in LM Studio settings (max GPU layers)
- Use a smaller model: phi-3-mini (3B) is fast with good accuracy
- Or use a cloud backend for speed

---

## Server Issues

### Server won't start

```bash
guardclaw status    # check if already running
guardclaw stop      # stop any stale process
guardclaw start
```

### Dashboard not loading

Make sure the server is running:
```bash
guardclaw status
```

Then open [localhost:3002](http://localhost:3002) manually.

### Hooks not working (Claude Code)

Reinstall hooks:
```bash
node scripts/install-claude-code.js
```

Then **restart Claude Code**. Hooks only activate after a restart.

---

## Config Issues

### Changes not applying

All config changes apply immediately via hot-reload. If a change doesn't seem to take effect, check the server is running:

```bash
guardclaw status
guardclaw config show
```

### Wrong backend being used

```bash
guardclaw config show   # verify SAFEGUARD_BACKEND value
```

Config is stored at `~/.guardclaw/.env`.

---

## Getting Help

Open an issue at [github.com/TobyGE/GuardClaw/issues](https://github.com/TobyGE/GuardClaw/issues) with:
- Output of `guardclaw status`
- Your `SAFEGUARD_BACKEND` and model name
- The full error message
