# LLM 后端

GuardClaw 支持多种 LLM 后端进行风险评分，所有云端后端均使用 OpenAI 兼容 API 格式。

## 快速对比

| 后端 | 隐私 | 速度 | 费用 | 适合场景 |
|------|------|------|------|---------|
| [内置 MLX](/zh/backends/builtin) | 100% 本地 | 快（Apple Silicon）| 免费 | Mac 用户，最简单 |
| [LM Studio](/zh/backends/local#lm-studio) | 100% 本地 | 快 | 免费 | 本地模型高级控制 |
| [Ollama](/zh/backends/local#ollama) | 100% 本地 | 快 | 免费 | Linux/Docker 环境 |
| [OpenRouter](/zh/backends/cloud#openrouter) | 云端 | 极快 | 按量付费 | 模型种类最多 |
| [Anthropic Claude](/zh/backends/cloud#anthropic) | 云端 | 快 | 按量付费 | 准确率最高 |
| [MiniMax](/zh/backends/cloud#minimax) | 云端 | 快 | 按量付费 | 性价比高的云端方案 |
| `fallback` | 本地 | 极快（<1ms）| 免费 | 无 LLM 时的纯规则模式 |

## 选择后端

```bash
guardclaw config llm
```

交互式选择器显示所有可用选项，支持输入 API Key 并在保存前测试连接。

## Fallback 模式

当没有可用 LLM 时，GuardClaw 使用基于规则的确定性评分：

```bash
guardclaw config set SAFEGUARD_BACKEND fallback
```

Fallback 模式：
- ✅ 极快（< 1ms）
- ✅ 零内存占用
- ✅ 对已知危险模式准确率高
- ❌ 无上下文理解能力
- ❌ 仅靠模式匹配，可能漏判新型攻击

建议作为最后手段或 LLM 宕机时的临时方案使用。
