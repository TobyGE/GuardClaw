# Cloud Backends

Cloud backends send tool call context to a remote API for scoring. Faster model options, but requires an API key and sends data off-device.

## OpenRouter {#openrouter}

[OpenRouter](https://openrouter.ai) provides access to dozens of models through a single API key — Claude, GPT-4o, Gemini, Mistral, and more.

```bash
guardclaw config set SAFEGUARD_BACKEND openrouter
guardclaw config set OPENROUTER_API_KEY sk-or-...
guardclaw config set OPENROUTER_MODEL openai/gpt-4o-mini
```

Recommended models for cost/accuracy balance:
- `openai/gpt-4o-mini` — fast, cheap, accurate
- `anthropic/claude-3-haiku` — excellent reasoning
- `google/gemini-flash-1.5` — very fast

---

## Anthropic Claude {#anthropic}

Direct Anthropic API. Highest accuracy for complex tool call analysis.

```bash
guardclaw config set SAFEGUARD_BACKEND anthropic
guardclaw config set ANTHROPIC_API_KEY sk-ant-...
```

GuardClaw uses `claude-haiku-4-5-20251001` by default (fast, low cost). Upgrade to Sonnet for maximum accuracy:

```bash
guardclaw config set ANTHROPIC_MODEL claude-sonnet-4-6
```

---

## MiniMax {#minimax}

[MiniMax](https://www.minimaxi.com) offers large-context models at competitive pricing.

```bash
guardclaw config set SAFEGUARD_BACKEND lmstudio
guardclaw config set LMSTUDIO_URL https://api.minimaxi.chat/v1
guardclaw config set LMSTUDIO_API_KEY your-minimax-key
guardclaw config set LMSTUDIO_MODEL MiniMax-M2.7
```

Available models:

| Model | Context | Notes |
|-------|---------|-------|
| `MiniMax-M2.7` | 205K | Best quality |
| `MiniMax-M2.5` | 205K | Balanced |
| `MiniMax-Text-01` | 1M | Largest context |

---

## Any OpenAI-compatible API

GuardClaw's `lmstudio` backend accepts any OpenAI-compatible endpoint. This covers DeepSeek, Groq, Fireworks, Together AI, and others:

```bash
guardclaw config set SAFEGUARD_BACKEND lmstudio
guardclaw config set LMSTUDIO_URL https://api.groq.com/openai/v1
guardclaw config set LMSTUDIO_API_KEY gsk_...
guardclaw config set LMSTUDIO_MODEL llama-3.1-70b-versatile
```
