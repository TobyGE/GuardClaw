# 本地后端

本地后端完全在你的机器上运行，无需 API Key，数据不离本机。

## LM Studio {#lm-studio}

[LM Studio](https://lmstudio.ai) 是大多数用户的推荐选择，通过图形界面下载模型，GuardClaw 连接其内置的 OpenAI 兼容服务器。

### 配置步骤

1. 下载并安装 [LM Studio](https://lmstudio.ai)
2. 下载模型（推荐：`qwen/qwen3-4b` 或 `qwen2.5-7b-instruct`）
3. 进入 **Local Server** 标签 → 点击 **Start Server**
4. 配置 GuardClaw：

```bash
guardclaw config set SAFEGUARD_BACKEND lmstudio
guardclaw config set LMSTUDIO_URL http://localhost:1234/v1
guardclaw config set LMSTUDIO_MODEL auto
```

`LMSTUDIO_MODEL=auto` 表示使用 LM Studio 当前加载的模型。

### 推荐模型

| 模型 | 参数量 | 准确率 | 速度 |
|------|--------|--------|------|
| `qwen/qwen3-4b-2507` | 4B | ⭐⭐⭐⭐⭐ | ⚡⚡⚡⚡ |
| `qwen2.5-7b-instruct` | 7B | ⭐⭐⭐⭐⭐ | ⚡⚡⚡ |
| `mistral-7b-instruct-v0.2` | 7B | ⭐⭐⭐⭐⭐ | ⚡⚡⚡ |
| `llama-3.1-8b-instruct` | 8B | ⭐⭐⭐⭐⭐ | ⚡⚡⚡ |
| `phi-3-mini-4k` | 3B | ⭐⭐⭐⭐ | ⚡⚡⚡⚡ |

避免使用 3B 以下的模型——它们难以可靠地输出 GuardClaw 所需的 JSON 格式。

### 使用 LM Studio 作为 OpenAI 兼容代理

LM Studio 也可以作为任意 OpenAI 兼容 API 的代理。如果端点需要认证，设置 `LMSTUDIO_API_KEY`：

```bash
guardclaw config set LMSTUDIO_API_KEY your-api-key
```

### 故障排查

详见[故障排查](/zh/troubleshooting)页面。

---

## Ollama {#ollama}

[Ollama](https://ollama.ai) 适合 Linux、Docker 和无图形界面环境。

### 配置步骤

1. 安装 [Ollama](https://ollama.ai)
2. 拉取模型：
   ```bash
   ollama pull qwen2.5:7b
   ```
3. 配置 GuardClaw：

```bash
guardclaw config set SAFEGUARD_BACKEND ollama
guardclaw config set OLLAMA_URL http://localhost:11434
guardclaw config set OLLAMA_MODEL qwen2.5:7b
```

### 启动 Ollama

GuardClaw 启动前需先运行 Ollama：

```bash
ollama serve   # 启动服务器
```

或安装为系统服务，详见 [Ollama 文档](https://github.com/ollama/ollama)。
