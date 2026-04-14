# 快速开始

需要 **Node.js >= 18**，无需注册账号。

## 安装

```bash
npm install -g guardclaw
guardclaw start
```

约 30 秒完成。首次启动会自动打开交互式配置向导。

## 配置向导

向导引导你完成四项选择：

1. **评估模式** — 本地 / 混合 / 云端
2. **LLM 后端** — 本地模型（LM Studio、Ollama、内置 MLX）或云端（Claude、OpenAI Codex、MiniMax、Kimi、OpenRouter、Gemini）
3. **响应模式** — `Auto`（标记并拦截危险调用）或 `Monitor only`（仅记录，不拦截）
4. **Agent 接入** — 自动检测已安装的 Agent，一键确认安装 Hook/插件

随时可以重新运行：

```bash
guardclaw setup
```

安装 Hook 后需重启目标 AI Agent。

## 控制台

启动后在浏览器打开 [localhost:3002](http://localhost:3002)。

控制台提供：
- 实时事件时间线（含风险评分）
- 按 Session 查看工具调用历史
- 拦截开关（无需重启）
- LLM 后端配置面板

## 风险等级

| 分数 | 等级 | 行为 |
|------|------|------|
| 1–3  | SAFE（安全）| 正常执行 |
| 4–7  | WARNING（警告）| 记录并增强审计信号 |
| 8–10 | HIGH RISK（高风险）| 拦截 / 需要审批 |

## 卸载

```bash
guardclaw stop
npm uninstall -g guardclaw
node scripts/install-claude-code.js --uninstall  # 移除 Hook
```
