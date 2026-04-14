# 支持的 Agent

GuardClaw 开箱即用，支持 7 款主流编程 Agent。

| Agent | 接入方式 | 执行前拦截 | 审批流程 |
|-------|---------|:---------:|:-------:|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | HTTP hooks | ✅ | ✅ |
| [Codex CLI](https://github.com/openai/codex) | 命令行 hooks | ✅ | ✅ |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | HTTP hooks | ✅ | ✅ |
| [OpenCode](https://opencode.ai) | HTTP hooks | ✅ | ✅ |
| [OpenClaw](https://github.com/openclaw/openclaw) | WebSocket 插件 | ✅ | ✅ |
| [Cursor](https://cursor.com) | Shell hooks | ⚠️ 仅 Shell | ✅ |
| [GitHub Copilot CLI](https://github.com/github/copilot-sdk) | HTTP hooks | ✅ | ✅ |

> **Cursor 说明：** 仅拦截 Shell 命令，文件读写操作（read/write/edit）不在拦截范围内。

## Hook 接入原理

### HTTP hooks（Claude Code、Gemini CLI、OpenCode、GitHub Copilot CLI）

GuardClaw 注册为 HTTP hook 处理器。每次工具调用前，Agent 向 `localhost:3002/api/cc/pre-tool` 发送 POST 请求，GuardClaw 评分后返回 `allow` 或 `block`。

安装：
```bash
node scripts/install-claude-code.js
```

卸载：
```bash
node scripts/install-claude-code.js --uninstall
```

### OpenClaw WebSocket 插件

`guardclaw-interceptor` 插件直接在 OpenClaw 网关中挂载 `before_tool_call` 钩子，支持对所有工具类型执行前拦截。

安装：
```bash
guardclaw plugin install
openclaw gateway restart
```

### 命令行 hooks（Codex CLI、Cursor）

GuardClaw 包装 Shell 命令执行。仅拦截 Shell 命令，文件读写不受影响。

## 安装 Hook

配置向导（`guardclaw setup`）会自动检测已安装的 Agent，一键确认即可安装所有 Hook。也可按上述命令手动为各 Agent 安装。

**安装 Hook 后请重启目标 Agent。**
