# CLI 快速参考

所有 GuardClaw CLI 命令的紧凑参考。详细文档请参考下方链接。

## 服务器

```bash
guardclaw start [-f] [--port N] [--no-open]    # 启动服务器
guardclaw stop                                   # 停止服务器
guardclaw restart                                # 重启（别名：rs, r）
guardclaw status                                 # 服务器概览
guardclaw update                                 # 更新到最新版本
```

[完整服务器文档 →](./server)

## 配置

```bash
guardclaw config                    # 交互式菜单
guardclaw config show               # 显示所有设置
guardclaw config set <KEY> <VALUE>  # 设置任意变量（热重载）
guardclaw config llm                # 更改 LLM 后端
guardclaw config mode               # 更改审批模式
guardclaw config thresholds         # 更改风险阈值
guardclaw config eval               # 更改评估模式
guardclaw config agents             # 管理 Agent 连接
guardclaw config set-token <tok>    # 设置 OpenClaw Token
guardclaw config detect-token       # 自动检测 OpenClaw Token
guardclaw config get-token          # 显示当前 Token
guardclaw setup                     # 运行配置向导
```

[完整配置文档 →](./config)

## 监控

```bash
guardclaw stats                     # 评估统计
guardclaw history [n]               # 最近评估（默认 20 条）
guardclaw check <命令>              # 手动评分命令
guardclaw blocking [on|off]         # 切换阻断模式
guardclaw model [load|unload]       # LLM 模型管理
guardclaw approvals                 # 查看待审批请求
guardclaw memory                    # 查看学习到的模式
guardclaw brief                     # 安全记忆会话
```

[完整监控文档 →](./monitoring)

## Hook

```bash
guardclaw hooks                              # 查看 Hook 状态
guardclaw hooks install [claude-code|codex|all]
guardclaw hooks uninstall [claude-code|codex|all]
```

[完整 Hook 文档 →](./hooks)

## 插件

```bash
guardclaw plugin install      # 安装 OpenClaw 拦截插件
guardclaw plugin uninstall    # 移除插件
guardclaw plugin status       # 查看状态
```

[完整插件文档 →](./plugin)

## 环境变量

所有配置存储在 `.env`。关键变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SAFEGUARD_BACKEND` | `lmstudio` | LLM 后端 |
| `GUARDCLAW_APPROVAL_MODE` | `auto` | 审批模式 |
| `GUARDCLAW_AUTO_ALLOW_THRESHOLD` | `6` | 自动允许阈值 |
| `GUARDCLAW_AUTO_BLOCK_THRESHOLD` | `9` | 自动阻断阈值 |
| `PORT` | `3002` | 服务器端口 |

[完整环境变量参考 →](./environment)
