# Using LM Studio with GuardClaw

GuardClaw 支持使用本地 LLM 进行命令安全分析，无需调用云端 API！

## 设置 LM Studio

### 1. 下载并安装 LM Studio

- 官网：<https://lmstudio.ai/>
- 支持 macOS, Windows, Linux
- 免费使用

### 2. 下载推荐模型

在 LM Studio 中搜索并下载：

**推荐模型（按性能排序）：**

**最佳性能：**

- `TheBloke/Mistral-7B-Instruct-v0.2-GGUF` (7B, ~4GB)
- `TheBloke/Llama-2-13B-Chat-GGUF` (13B, ~8GB)

**平衡选择：**

- `TheBloke/Phi-2-GGUF` (2.7B, ~2GB) - 轻量但智能
- `TheBloke/TinyLlama-1.1B-Chat-GGUF` (1.1B, ~1GB) - 超快速

**最强大（需要好显卡）：**

- `TheBloke/CodeLlama-34B-Instruct-GGUF` (34B, ~20GB)
- `TheBloke/Mixtral-8x7B-Instruct-v0.1-GGUF` (47B, ~26GB)

**提示：** 下载 `Q4_K_M` 或 `Q5_K_M` 量化版本，平衡质量和速度。

### 3. 启动 LM Studio Server

1. 在 LM Studio 中加载模型
2. 点击 **"Local Server"** 标签
3. 点击 **"Start Server"**
4. 默认运行在 `http://localhost:1234`

### 4. 配置 GuardClaw

编辑 `.env` 文件：

```bash
# 使用 LM Studio 后端
SAFEGUARD_BACKEND=lmstudio

# LM Studio 配置
LMSTUDIO_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=auto
```

### 5. 重启 GuardClaw

```bash
npm start
```

## 测试分析

启动后，GuardClaw 会自动使用 LM Studio 分析命令：

```bash
# 在 GuardClaw Dashboard 中观察这些命令的风险评分：

# 安全命令
ls -la ~/documents        # 应该是 1-2/10 (safe)
cat README.md             # 应该是 1/10 (safe)

# 中等风险
rm old-file.txt           # 应该是 5-6/10 (warning)
curl https://api.com      # 应该是 3-4/10 (safe-warning)

# 高风险
rm -rf /tmp/*            # 应该是 7-8/10 (danger)
sudo rm -rf /            # 应该是 10/10 (blocked)
```

## 故障排查

### LM Studio 连接失败

**错误：** `LM Studio analysis failed: fetch failed`

**解决方法：**

1. 确认 LM Studio Server 正在运行（绿色 "Running" 标志）
2. 检查端口：默认 `1234`
3. 测试连接：

```bash
curl http://localhost:1234/v1/models
```

### 模型响应太慢

**问题：** 命令分析需要 5-10 秒

**解决方法：**

1. 使用更小的模型（Phi-2, TinyLlama）
2. 检查 CPU/GPU 使用率
3. 在 LM Studio 中调整 `Context Length` 和 `GPU Layers`

### JSON 解析失败

**错误：** `Failed to parse response`

**解决方法：**

1. 使用指令微调模型（Instruct variants）
2. 在 LM Studio 设置中降低 `Temperature` (0.1-0.3)
3. GuardClaw 会自动 fallback 到模式匹配

## 性能对比

| Backend                    | 延迟   | 准确度 | 成本 | 隐私 |
| -------------------------- | ------ | ------ | ---- | ---- |
| **LM Studio (Mistral 7B)** | ~1-2s  | 4/5    | 免费 | 本地 |
| **LM Studio (Phi-2)**      | ~0.5s  | 3/5    | 免费 | 本地 |
| **Claude API**             | ~0.3s  | 5/5    | $$   | 云端 |
| **Fallback (pattern)**     | ~0.01s | 2/5    | 免费 | 本地 |

## 其他本地选项

### Ollama

```bash
# .env
SAFEGUARD_BACKEND=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3

# 安装 Ollama: https://ollama.ai/
ollama run llama3
```

### 自托管 API

GuardClaw 兼容任何 OpenAI-compatible API 端点。

## 推荐配置

**开发环境（速度优先）：**

```bash
SAFEGUARD_BACKEND=lmstudio
LMSTUDIO_MODEL=phi-2
```

**生产环境（准确度优先）：**

```bash
SAFEGUARD_BACKEND=lmstudio
LMSTUDIO_MODEL=mistral-7b-instruct
```

**低资源设备：**

```bash
SAFEGUARD_BACKEND=fallback  # 使用模式匹配
```

## 提示

1. **首次加载慢**：第一次分析会加载模型，需要 10-30 秒
2. **批量分析**：LM Studio 支持并发请求
3. **多模型切换**：可以在 LM Studio 中快速切换模型测试效果
4. **GPU 加速**：在 LM Studio 设置中启用 GPU offloading 可显著提速

---

**需要帮助？** 检查 GuardClaw 日志：

```bash
tail -f ~/clawd/guardclaw/guardclaw.log
```
