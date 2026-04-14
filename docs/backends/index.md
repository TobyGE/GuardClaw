# LLM Backends

GuardClaw supports multiple LLM backends for risk scoring. All cloud backends use the OpenAI-compatible API format.

## Quick Comparison

| Backend | Privacy | Speed | Cost | Best for |
|---------|---------|-------|------|----------|
| [Built-in MLX](/backends/builtin) | 100% local | Fast (Apple Silicon) | Free | Mac users, easiest setup |
| [LM Studio](/backends/local#lm-studio) | 100% local | Fast | Free | Advanced local model control |
| [Ollama](/backends/local#ollama) | 100% local | Fast | Free | Linux/Docker environments |
| [OpenRouter](/backends/cloud#openrouter) | Cloud | Very fast | Pay-per-use | Best model variety |
| [Anthropic Claude](/backends/cloud#anthropic) | Cloud | Fast | Pay-per-use | Highest accuracy |
| [MiniMax](/backends/cloud#minimax) | Cloud | Fast | Pay-per-use | Cost-effective cloud option |
| `fallback` | Local | Instant | Free | No LLM available, rule-only |

## Selecting a Backend

```bash
guardclaw config llm
```

The interactive picker shows available options, lets you enter API keys, and tests the connection before saving.

## Fallback Mode

If no LLM is available, GuardClaw uses deterministic rule-based scoring:

```bash
guardclaw config set SAFEGUARD_BACKEND fallback
```

Fallback mode:
- ✅ Instant (< 1ms per call)
- ✅ Zero memory usage
- ✅ Catches known-dangerous patterns reliably
- ❌ No context understanding
- ❌ Pattern-matching only — may miss novel attacks

Use fallback as a last resort or during LLM downtime.
