# GuardClaw 核心改进 ✨

## 已实现的改进 (2024-02-08)

### 1. ✅ 自动重连机制
**问题**：WebSocket 连接断开后无法自动恢复

**解决方案**：
- 实现指数退避重连策略（5s → 7.5s → 11.25s ... 最多 30s）
- 连接状态回调（onConnect, onDisconnect, onReconnecting）
- 优雅的断线检测和重连调度
- 区分主动断开和意外断开

**效果**：
```
[ClawdbotClient] 🔄 Reconnecting in 5s (attempt 1)...
[ClawdbotClient] Attempting reconnect...
[ClawdbotClient] ✅ Connected successfully
```

### 2. ✅ 智能降级方案
**问题**：当 Gateway 不支持 `sessions.history` API 时持续报错

**解决方案**：
- 启动时自动测试 API 可用性
- 检测 `unknown method` 错误并自动降级
- 优雅回退到事件监听模式
- 清晰的状态提示和建议

**降级路径**：
1. **全功能模式**：`sessions.list` + `sessions.history` ✅
2. **降级模式**：仅实时事件监听 ⚠️
3. **状态报告**：API `/api/status` 显示当前模式和建议

**效果**：
```
[SessionPoller] ⚠️  sessions.history not supported by Gateway
[SessionPoller] Falling back to event-only mode
[SessionPoller] Only real-time events will be captured
[SessionPoller] To enable full history: grant operator.admin scope to your token
```

### 3. ✅ 智能轮询优化
**问题**：每 5 秒固定轮询，浪费 API 调用

**解决方案**：
- 基于活动检测的智能轮询
- 无活动时自动跳过轮询
- 实时事件触发活动记录
- 连续错误后自动暂停

**效果**：
- 有活动时：正常轮询（5s 间隔）
- 无活动 >1min：自动跳过
- 降级模式：完全停止轮询，节省 API 调用

### 4. ✅ 增强错误处理
**问题**：错误信息不清晰，难以排查

**解决方案**：
- 详细的启动输出和状态报告
- 分类错误处理（权限/API/网络/未知）
- 连续错误计数和自动暂停
- 清晰的建议和故障排查提示

**错误分类**：
- **权限错误** → 降级到事件模式 + 提示如何授权
- **API 不支持** → 降级到事件模式 + 提示 Gateway 版本
- **网络错误** → 自动重连
- **连续错误** → 暂停轮询，等待活动

**新增 API 端点**：
```json
GET /api/status
{
  "connected": true,
  "pollerMode": "event-only",
  "healthy": true,
  "warnings": [
    {
      "level": "info",
      "message": "Running in event-only mode",
      "suggestion": "Grant operator.admin scope for full history"
    }
  ]
}
```

## 技术细节

### ClawdbotClient 改进
**新增配置选项**：
```javascript
new ClawdbotClient(url, token, {
  autoReconnect: true,           // 自动重连
  reconnectDelay: 5000,          // 初始重连延迟
  maxReconnectDelay: 30000,      // 最大重连延迟
  onConnect: () => {},           // 连接成功回调
  onDisconnect: () => {},        // 断开连接回调
  onReconnecting: (attempt, delay) => {}  // 重连中回调
})
```

**新增方法**：
```javascript
client.scheduleReconnect()      // 调度重连
client.getConnectionStats()     // 获取连接统计
```

### SessionPoller 改进
**新增状态跟踪**：
```javascript
{
  hasAdminScope: null,          // null=未知, true/false=已测试
  mode: 'unknown',              // 'polling' | 'event-only'
  consecutiveErrors: 0,         // 连续错误计数
  lastActivityTime: Date.now()  // 最后活动时间
}
```

**新增方法**：
```javascript
poller.testPermissions()        // 测试 API 权限
poller.smartPoll()             // 智能轮询（基于活动）
poller.recordActivity()        // 记录活动时间
```

## 状态指示

### 连接状态
- ✅ **已连接** - 绿色，正常
- 🔄 **重连中** - 黄色，自动恢复
- ❌ **断开** - 红色，需要检查

### 轮询模式
- 🟢 **polling** - 全功能，可访问历史
- 🟡 **event-only** - 降级，仅实时事件
- 🔴 **error** - 错误，需要修复

### 健康状态
- `healthy: true` - 连接正常，错误 < 3
- `healthy: false` - 连接异常或错误 ≥ 3

## 使用建议

### 开发环境
```bash
# .env
AUTO_CONNECT=true              # 自动连接
POLL_INTERVAL=5000            # 5秒轮询（如果支持）
SAFEGUARD_BACKEND=lmstudio    # 本地 LLM
```

### 生产环境
```bash
# .env
AUTO_CONNECT=true
POLL_INTERVAL=10000           # 10秒轮询（减少负载）
SAFEGUARD_BACKEND=anthropic   # 云端 LLM（更准确）
```

### 监控
```bash
# 实时日志
tail -f guardclaw/guardclaw.log

# 状态检查
curl http://localhost:3001/api/status | jq

# 事件历史
curl http://localhost:3001/api/events/history?limit=50 | jq
```

## 下一步计划

### 🚀 新功能
- [ ] 命令审批流程（实时拦截危险命令）
- [ ] 历史回放功能
- [ ] 统计面板（风险分析、命令排行）
- [ ] 导出审计日志（JSON/CSV）

### 🎨 UI/UX
- [ ] 实时桌面通知
- [ ] 执行流程可视化
- [ ] 风险热力图
- [ ] 暗色主题

### 🔧 技术优化
- [ ] 事件去重（避免重复分析）
- [ ] 批量分析（减少 LLM 调用）
- [ ] 缓存机制（相似命令复用结果）
- [ ] 性能监控（分析延迟、错误率）

## 故障排查

### 问题：无法连接
```
❌ Connection failed: Connection timeout
```
**解决**：
1. 检查 Clawdbot Gateway 是否运行：`clawdbot status`
2. 验证 `CLAWDBOT_URL` 配置
3. 检查防火墙/网络设置

### 问题：权限不足
```
⚠️  Missing operator.admin scope
```
**解决**：
1. 检查 token 权限
2. 重新生成 token with `operator.admin` scope
3. 或者接受 event-only 模式

### 问题：API 不支持
```
⚠️  sessions.history not supported by Gateway
```
**解决**：
1. 升级 Clawdbot Gateway 到最新版本
2. 或者接受 event-only 模式（仍可监控实时命令）

---

**更新时间**: 2024-02-08
**版本**: v0.2.0
**作者**: clawd 🐾
