# 故障排查

## LM Studio 问题

### API 返回 400 错误

模型未加载或模型太小，无法生成有效 JSON 输出。

**解决方法：** 在 LM Studio 的 **Local Server** 标签中加载推荐模型（qwen3-4b、mistral-7b、llama-3.1-8b），然后点击 **Load Model**。

避免使用 3B 以下的模型——它们无法可靠地生成 GuardClaw 所需的 JSON 格式。

### JSON 解析失败

```
Failed to parse response: Unexpected token '<'
```

模型输出了 `<think>` 标签而非 JSON。使用 `SAFEGUARD_BACKEND=lmstudio` 并将 temperature 设为 0.1。

或临时切换到 `fallback` 后端：
```bash
guardclaw config set SAFEGUARD_BACKEND fallback
```

### "No models loaded"

在 LM Studio 中：点击模型名称 → **Load Model** → 等待显示绿色 **Loaded** 状态。

### 分析太慢（每次 5–10 秒）

- 在 LM Studio 设置中开启 GPU 加速（最大化 GPU layers）
- 使用更小的模型：phi-3-mini（3B）速度快且准确
- 切换到云端后端以获得更快响应

---

## 服务器问题

### 服务器无法启动

```bash
guardclaw status    # 检查是否已在运行
guardclaw stop      # 停止残留进程
guardclaw start
```

### 控制台无法加载

确认服务器正在运行：
```bash
guardclaw status
```

然后手动打开 [localhost:3002](http://localhost:3002)。

### Hook 不生效（Claude Code）

重新安装 Hook：
```bash
node scripts/install-claude-code.js
```

然后**重启 Claude Code**。Hook 只在重启后生效。

---

## 配置问题

### 更改未生效

所有配置更改通过热重载立即应用。如果更改似乎没有生效，确认服务器正在运行：

```bash
guardclaw status
guardclaw config show
```

### 后端配置不对

```bash
guardclaw config show   # 确认 SAFEGUARD_BACKEND 的值
```

配置存储在 `~/.guardclaw/.env`。

---

## 获取帮助

在 [github.com/TobyGE/GuardClaw/issues](https://github.com/TobyGE/GuardClaw/issues) 提交 Issue，请附上：
- `guardclaw status` 的输出
- 你的 `SAFEGUARD_BACKEND` 和模型名称
- 完整的错误信息
