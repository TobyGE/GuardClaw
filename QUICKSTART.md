# GuardClaw 快速开始 🛡️

## 一键启动

```bash
cd guardclaw
npm start
```

GuardClaw 会自动：
- ✅ 连接到 Clawdbot Gateway
- ✅ 检测可用的 API 功能
- ✅ 启动合适的监控模式
- ✅ 如果断线会自动重连

## 监控模式

### 🟢 全功能模式（Polling Mode）
**条件**: Gateway 支持 `sessions.history` API + `operator.admin` scope

**功能**:
- ✅ 实时事件监控
- ✅ 历史命令回溯
- ✅ 完整的执行轨迹

### 🟡 事件模式（Event-Only Mode）
**条件**: Gateway 不支持历史 API 或缺少权限

**功能**:
- ✅ 实时事件监控
- ⚠️  无法回溯历史命令

**提示**: 这仍然很有用！你能看到所有实时执行的命令和 AI 分析。

## 检查状态

```bash
# 查看连接和模式
curl http://localhost:3001/api/status | jq

# 查看最近事件
curl http://localhost:3001/api/events/history?limit=10 | jq

# 实时日志
tail -f guardclaw.log
```

## 健康检查

**健康指标**:
```json
{
  "connected": true,      // ✅ 已连接到 Gateway
  "healthy": true,        // ✅ 整体健康
  "pollerMode": "event-only",  // 当前模式
  "warnings": [...]       // 如果有问题会显示建议
}
```

## 安全分析后端

GuardClaw 支持多种 AI 后端分析命令风险：

### 🏠 本地模式（推荐新手）
```bash
# .env
SAFEGUARD_BACKEND=lmstudio
LMSTUDIO_URL=http://localhost:1234/v1
```

**优点**: 免费、隐私、低延迟
**缺点**: 需要下载模型（~4GB）

→ 详见 `LMSTUDIO.md`

### ☁️ 云端模式（最准确）
```bash
# .env
SAFEGUARD_BACKEND=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

**优点**: 最高准确度
**缺点**: 需要 API key、有费用

### ⚡ 降级模式（最快）
```bash
# .env
SAFEGUARD_BACKEND=fallback
```

**优点**: 零延迟、零成本
**缺点**: 仅模式匹配，不够智能

## 常见场景

### 场景 1: 开发测试
```bash
# 使用 fallback 模式快速测试
SAFEGUARD_BACKEND=fallback npm start
```

### 场景 2: 本地生产
```bash
# 启动 LM Studio + GuardClaw
# 1. 打开 LM Studio，加载 Mistral 7B
# 2. 启动 Server (http://localhost:1234)
# 3. 启动 GuardClaw
SAFEGUARD_BACKEND=lmstudio npm start
```

### 场景 3: 云端生产
```bash
# 使用 Claude API
SAFEGUARD_BACKEND=anthropic npm start
```

## Web Dashboard

打开浏览器访问: **http://localhost:3001**

**功能**:
- 📊 实时事件流
- 🛡️ 命令风险分析
- 📈 统计图表
- 🔍 搜索和过滤

## 故障排查

### ❌ 无法连接 Gateway
```
❌ Connection failed: Connection timeout
```

**解决**:
```bash
# 检查 Clawdbot 是否运行
clawdbot status

# 检查配置
cat .env | grep CLAWDBOT_URL

# 应该是: ws://127.0.0.1:18789
```

### ⚠️ 降级到事件模式
```
⚠️  sessions.history not supported by Gateway
```

**原因**: 你的 Clawdbot Gateway 版本不支持历史 API

**解决**:
- **选项 1**: 升级 Clawdbot（推荐）
- **选项 2**: 接受事件模式（仍然很有用！）

### 🔴 分析失败
```
LM Studio analysis failed: fetch failed
```

**解决**:
```bash
# 检查 LM Studio Server 是否运行
curl http://localhost:1234/v1/models

# 或切换到 fallback 模式
SAFEGUARD_BACKEND=fallback npm restart
```

## 下一步

- 📖 阅读 `IMPROVEMENTS.md` 了解技术细节
- 🏠 阅读 `LMSTUDIO.md` 设置本地 LLM
- 🎯 查看 `TOOLS.md` 了解命令示例

## 停止服务

```bash
# Ctrl+C 或
npm run stop
```

---

**需要帮助？** 查看日志: `tail -f guardclaw.log`
