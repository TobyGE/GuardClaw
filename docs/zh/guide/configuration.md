# 配置

所有配置存储在 `~/.guardclaw/.env`。可通过 CLI 或控制台 Settings 面板修改，无需手动编辑文件。

## CLI 配置命令

```bash
guardclaw config llm          # 交互式选择 LLM 后端
guardclaw config mode         # 设置审批模式（auto / prompt / monitor-only）
guardclaw config thresholds   # 设置风险分数阈值
guardclaw config show         # 查看当前配置
guardclaw config set KEY VALUE  # 直接设置某个环境变量（立即生效）
```

所有 `config` 命令均通过热重载立即应用到运行中的服务器，**无需重启**。

## 审批模式

| 模式 | 行为 |
|------|------|
| `auto` | 分数 ≤ 6 自动放行，分数 ≥ 9 自动拦截，7–8 警告 |
| `prompt` | 分数 7–8 时向用户请求审批 |
| `monitor-only` | 永不拦截，仅记录日志 |

通过 CLI 设置：
```bash
guardclaw config mode
# 或直接：
guardclaw config set GUARDCLAW_APPROVAL_MODE prompt
```

## 风险阈值

| 变量 | 默认值 | 含义 |
|------|--------|------|
| `GUARDCLAW_AUTO_ALLOW_THRESHOLD` | `6` | 分数 ≤ 此值 → 自动放行 |
| `GUARDCLAW_ASK_THRESHOLD` | `8` | 分数 ≤ 此值 → 向用户请求审批（prompt 模式）|
| `GUARDCLAW_AUTO_BLOCK_THRESHOLD` | `9` | 分数 ≥ 此值 → 自动拦截 |

```bash
guardclaw config thresholds
```

## 环境变量完整列表

```bash
# LLM 后端
SAFEGUARD_BACKEND=lmstudio    # lmstudio | ollama | anthropic | built-in | openrouter | fallback

# LM Studio
LMSTUDIO_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=auto
LMSTUDIO_API_KEY=             # 可选，用于托管的 OpenAI 兼容端点

# Ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# OpenRouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=openai/gpt-4o

# 审批
GUARDCLAW_APPROVAL_MODE=auto
GUARDCLAW_AUTO_ALLOW_THRESHOLD=6
GUARDCLAW_ASK_THRESHOLD=8
GUARDCLAW_AUTO_BLOCK_THRESHOLD=9

# 服务器
PORT=3002
```

## 控制台 Settings 面板

点击控制台右上角 ⚙️ 图标：
- 切换 LLM 后端和模型
- 测试后端连接
- 切换 fail-closed 模式
- 管理白名单/黑名单

所有更改立即生效，无需重启。
