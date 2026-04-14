# 内置 MLX 后端

内置后端直接在 GuardClaw 内部下载并运行 LLM——无需安装 LM Studio 或 Ollama。使用 Apple Silicon MLX 进行快速高效的推理。

**系统要求：** macOS + Apple Silicon（M1/M2/M3/M4）。

## 配置

配置向导可以自动完成配置。或手动设置：

```bash
guardclaw config set SAFEGUARD_BACKEND built-in
```

首次使用时，GuardClaw 会提示你下载模型，模型存储在 `~/.guardclaw/models/`。

## 模型管理

```bash
guardclaw config llm   # 交互式模型管理（下载、加载、卸载）
```

或在控制台 **Settings → Model** 面板中操作：
- 浏览可用模型
- 带进度条下载
- 一键加载 / 卸载

## 工作原理

GuardClaw 在 8081 端口启动 `mlx_lm.server` 子进程，使用位于 `~/.guardclaw/venv/` 的 Python 虚拟环境。首次使用时自动创建虚拟环境。

模型文件（约 2–4 GB）下载一次后缓存在 `~/.guardclaw/models/`。

## 磁盘占用

| 路径 | 内容 |
|------|------|
| `~/.guardclaw/venv/` | Python 虚拟环境 + mlx_lm（约 500 MB）|
| `~/.guardclaw/models/` | 下载的模型权重（每个 2–4 GB）|

释放空间：
```bash
guardclaw config llm   # → 卸载 / 删除模型
```
