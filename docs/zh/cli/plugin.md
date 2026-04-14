# 插件管理

`guardclaw plugin` 命令管理 OpenClaw 的 GuardClaw 拦截插件。该插件支持通过 OpenClaw 网关**执行前阻断**工具调用。

```bash
guardclaw plugin [install|uninstall|status]
```

## 工作原理

拦截插件挂钩到 OpenClaw 的 `before_tool_call` 事件。当任何通过 OpenClaw 连接的 Agent 即将执行工具调用时：

1. 插件拦截该调用
2. 发送到 GuardClaw 的 `/api/evaluate` 端点
3. 基于风险评分，**在执行前**允许或阻止

这与 WebSocket 监控不同 — WebSocket 只在事件发生后观察。插件提供真正的执行前阻断。

## 安装

```bash
guardclaw plugin install
```

此命令执行：

1. 从 GuardClaw 包复制插件文件到 `~/.openclaw/plugins/guardclaw-interceptor/`
2. 在 `~/.openclaw/openclaw.json` 中注册插件
3. 启用插件

```
📦 Installing GuardClaw interceptor plugin...

✅ Plugin files copied to: ~/.openclaw/plugins/guardclaw-interceptor
✅ Plugin enabled in OpenClaw config

⚠️  Restart OpenClaw Gateway: openclaw gateway restart
```

::: warning
安装插件后，必须重启 OpenClaw 网关才能生效：
```bash
openclaw gateway restart
```
:::

## 卸载

```bash
guardclaw plugin uninstall
```

移除插件：

1. 从 OpenClaw 的 `plugins.load.paths` 移除插件路径
2. 从 `plugins.entries` 删除插件条目
3. 删除 `~/.openclaw/plugins/guardclaw-interceptor/` 中的插件文件

## 状态

```bash
guardclaw plugin status
```

检查拦截插件的当前状态：

```
🔌 GuardClaw Interceptor Plugin

  Files    : ✅  ~/.openclaw/plugins/guardclaw-interceptor
  Registered: ✅
  Enabled  : ✅

  → Active. Restart gateway if recently changed.
```

状态检查三项：

| 检查项 | 说明 |
|--------|------|
| Files | 插件文件存在于安装位置 |
| Registered | 插件路径在 OpenClaw 的 `plugins.load.paths` 中 |
| Enabled | 插件在 `plugins.entries` 中已启用 |

### 可能的状态

| 状态 | 提示信息 |
|------|----------|
| 未安装 | `→ Run: guardclaw plugin install` |
| 已安装但已禁用 | `→ Enable via Dashboard (Blocking toggle)` |
| 生效中 | `→ Active. Restart gateway if recently changed.` |

## 插件位置

| 路径 | 说明 |
|------|------|
| 源码 | `<guardclaw>/plugin/guardclaw-interceptor/` |
| 安装目标 | `~/.openclaw/plugins/guardclaw-interceptor/` |
| 配置 | `~/.openclaw/openclaw.json` |

## 前置条件

插件要求：

- 已安装并配置 OpenClaw
- OpenClaw 配置位于 `~/.openclaw/openclaw.json`
- GuardClaw 服务器运行在同一台机器上（插件调用 `http://127.0.0.1:3002/api/evaluate`）
