# LM Studio 故障排查

## 常见问题和解决方案

### 1. LM Studio API 400 错误

**症状：**
```
LM Studio analysis failed: Error: LM Studio API error: 400
```

**原因：**
- 模型未加载到推理引擎
- 模型太小，无法完成任务
- 模型输出格式不兼容

**解决方案：**

#### 方案 A：使用推荐的模型

在 LM Studio 中加载以下推荐模型之一：

**最佳选择（推荐）：**
- `llama-3.1-8b-instruct` - 快速且准确
- `mistral-7b-instruct-v0.2` - 优秀的推理能力
- `qwen-2.5-7b-instruct` - 强大的多语言支持

**备选（如果资源有限）：**
- `phi-3-mini-4k` - 轻量但功能完整
- `gemma-2b-it` - Google 的小型模型

**不推荐：**
- ❌ `qwen3-1.7b` - 太小，无法可靠输出 JSON
- ❌ `tinyllama-1.1b` - 太小，准确度低
- ❌ embedding 模型 - 不是对话模型

然后在 `.env` 中配置：

```bash
LMSTUDIO_MODEL=llama-3.1-8b-instruct
# 或者
LMSTUDIO_MODEL=mistral-7b-instruct-v0.2
```

#### 方案 B：使用 Fallback 模式

如果你的机器无法运行大模型，使用基于规则的 fallback 模式：

```bash
# .env
SAFEGUARD_BACKEND=fallback
```

Fallback 模式的优点：
- ✅ 极快（<10ms）
- ✅ 零内存占用
- ✅ 对常见危险命令准确度高

Fallback 模式的缺点：
- ❌ 无上下文理解
- ❌ 只基于模式匹配
- ❌ 可能误判复杂命令

### 2. JSON 解析失败

**症状：**
```
Failed to parse response: SyntaxError: Unexpected token '<'
Failed to parse response: Unexpected end of JSON input
```

**原因：**
- 模型输出了 `<think>` 标签而不是 JSON
- 模型太小，输出不完整
- 模型输出被截断

**解决方案：**

1. **使用更大的模型**（见上面的推荐列表）

2. **在 LM Studio 中调整设置：**
   - Temperature: 0.1-0.3（更低 = 更确定性）
   - Context Length: 2048+
   - GPU Layers: 最大化（如果有 GPU）

3. **检查模型是否正确加载：**
   ```bash
   curl http://localhost:1234/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{
       "model": "你的模型名称",
       "messages": [{"role": "user", "content": "Hi"}],
       "max_tokens": 10
     }'
   ```

### 3. 模型崩溃

**症状：**
```
The model has crashed without additional information. (Exit code: null)
```

**原因：**
- 模型文件损坏
- 内存不足
- GPU 驱动问题

**解决方案：**

1. **检查可用内存：**
   - 7B 模型需要 ~6-8 GB RAM
   - 13B 模型需要 ~12-16 GB RAM
   - 使用 GPU 可以减少 RAM 需求

2. **重新下载模型：**
   - 在 LM Studio 中删除模型
   - 重新下载

3. **降低 GPU Layers：**
   - 如果使用 GPU，尝试减少 GPU layers
   - 或完全禁用 GPU offloading

### 4. 分析太慢

**症状：**
每个命令分析需要 5-10 秒

**解决方案：**

1. **启用 GPU 加速：**
   - 在 LM Studio 设置中最大化 GPU layers
   - 确保 CUDA/Metal 正确安装

2. **使用更小但高效的模型：**
   - `phi-3-mini-4k` (3B参数，但很快)
   - `mistral-7b` (7B参数，速度/质量平衡)

3. **使用 Fallback 模式：**
   ```bash
   SAFEGUARD_BACKEND=fallback
   ```

### 5. "No models loaded" 错误

**症状：**
```
No models loaded. Please load a model in the developer page
```

**原因：**
LM Studio 的 /v1/models 接口返回了模型列表，但模型未加载到推理引擎。

**解决方案：**

1. **在 LM Studio 中：**
   - 点击模型名称
   - 点击 "Load Model" 按钮
   - 等待模型完全加载（显示绿色 "Loaded" 状态）

2. **检查 Local Server 标签：**
   - 应该显示已加载的模型名称
   - 如果显示 "No model loaded"，需要先加载模型

3. **验证模型是否可用：**
   ```bash
   curl http://localhost:1234/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{
       "model": "你的模型名称",
       "messages": [{"role": "user", "content": "test"}],
       "max_tokens": 1
     }'
   ```

## 推荐配置

### 开发环境（平衡速度和准确度）

```bash
# .env
SAFEGUARD_BACKEND=lmstudio
LMSTUDIO_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=mistral-7b-instruct-v0.2
```

**LM Studio 设置：**
- Temperature: 0.1
- Context Length: 2048
- GPU Layers: 最大

### 低资源环境

```bash
# .env
SAFEGUARD_BACKEND=fallback
```

或者使用极小模型：

```bash
SAFEGUARD_BACKEND=lmstudio
LMSTUDIO_MODEL=phi-3-mini-4k
```

### 生产环境（最高准确度）

```bash
# .env
SAFEGUARD_BACKEND=anthropic
ANTHROPIC_API_KEY=your_key_here
```

或者使用大模型：

```bash
SAFEGUARD_BACKEND=lmstudio
LMSTUDIO_MODEL=llama-3.1-8b-instruct
```

## 性能对比

| 模型 | 大小 | 速度 | 准确度 | 内存 |
|------|------|------|--------|------|
| fallback (规则) | - | ⚡⚡⚡⚡⚡ | ⭐⭐⭐ | - |
| qwen3-1.7b | 1.7B | ⚡⚡⚡⚡ | ⭐⭐ | ~2GB |
| phi-3-mini | 3B | ⚡⚡⚡⚡ | ⭐⭐⭐⭐ | ~4GB |
| mistral-7b | 7B | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | ~6GB |
| llama-3.1-8b | 8B | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | ~8GB |
| claude-sonnet | API | ⚡⚡⚡⚡ | ⭐⭐⭐⭐⭐ | - |

## 获取帮助

如果问题仍然存在：

1. 查看 GuardClaw 日志：
   ```bash
   tail -f ~/clawd/guardclaw.log
   ```

2. 测试 LM Studio API：
   ```bash
   curl http://localhost:1234/v1/models
   ```

3. 提交 issue：
   - 包含完整的错误日志
   - 提供你的模型名称和大小
   - 说明你的系统配置（RAM, GPU）
