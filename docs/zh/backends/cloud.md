# 云端后端

云端后端将工具调用上下文发送到远程 API 进行评分。模型选择更多，速度更快，但需要 API Key 且数据会离开本机。

## OpenRouter {#openrouter}

[OpenRouter](https://openrouter.ai) 通过一个 API Key 访问数十种模型——Claude、GPT-4o、Gemini、Mistral 等。

```bash
guardclaw config set SAFEGUARD_BACKEND openrouter
guardclaw config set OPENROUTER_API_KEY sk-or-...
guardclaw config set OPENROUTER_MODEL openai/gpt-4o-mini
```

推荐模型（性价比高）：
- `openai/gpt-4o-mini` — 快速、便宜、准确
- `anthropic/claude-3-haiku` — 推理能力强
- `google/gemini-flash-1.5` — 速度极快

---

## Anthropic Claude {#anthropic}

直接调用 Anthropic API，复杂工具调用分析准确率最高。

```bash
guardclaw config set SAFEGUARD_BACKEND anthropic
guardclaw config set ANTHROPIC_API_KEY sk-ant-...
```

GuardClaw 默认使用 `claude-haiku-4-5-20251001`（快速、低成本）。如需最高准确率：

```bash
guardclaw config set ANTHROPIC_MODEL claude-sonnet-4-6
```

---

## MiniMax {#minimax}

[MiniMax](https://www.minimaxi.com) 提供大上下文窗口模型，价格有竞争力。

```bash
guardclaw config set SAFEGUARD_BACKEND lmstudio
guardclaw config set LMSTUDIO_URL https://api.minimaxi.chat/v1
guardclaw config set LMSTUDIO_API_KEY your-minimax-key
guardclaw config set LMSTUDIO_MODEL MiniMax-M2.7
```

可用模型：

| 模型 | 上下文长度 | 说明 |
|------|-----------|------|
| `MiniMax-M2.7` | 205K | 效果最佳 |
| `MiniMax-M2.5` | 205K | 均衡选择 |
| `MiniMax-Text-01` | 1M | 超长上下文 |

---

## 任意 OpenAI 兼容 API

GuardClaw 的 `lmstudio` 后端支持任意 OpenAI 兼容端点，涵盖 DeepSeek、Groq、Fireworks、Together AI 等：

```bash
guardclaw config set SAFEGUARD_BACKEND lmstudio
guardclaw config set LMSTUDIO_URL https://api.groq.com/openai/v1
guardclaw config set LMSTUDIO_API_KEY gsk_...
guardclaw config set LMSTUDIO_MODEL llama-3.1-70b-versatile
```
