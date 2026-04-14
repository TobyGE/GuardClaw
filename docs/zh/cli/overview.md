# CLI 概览

GuardClaw 提供了功能完整的命令行界面，用于管理安全监控器、配置 LLM 后端、连接 AI Agent 以及查看评估结果。

## 安装

### 通过 npm 全局安装

```bash
npm install -g guardclaw
```

安装完成后，`guardclaw` 命令即可全局使用。

### 从源码安装

```bash
git clone https://github.com/TobyGE/GuardClaw.git
cd GuardClaw
npm install && npm install --prefix client && npm run build
npm link
```

### 验证安装

```bash
guardclaw version
# GuardClaw v0.1.6
```

## 命令概览

| 命令 | 说明 |
|------|------|
| [`start`](./server.md#start) | 启动 GuardClaw 服务器 |
| [`stop`](./server.md#stop) | 停止服务器 |
| [`restart`](./server.md#restart) | 重启服务器 |
| [`status`](./server.md#status) | 服务器和 Agent 连接概览 |
| [`update`](./server.md#update) | 更新到最新版本 |
| [`setup`](./config.md#setup-wizard) | 运行交互式配置向导 |
| [`config`](./config.md) | 配置管理 |
| [`hooks`](./hooks.md) | 管理 Agent Hook 集成 |
| [`plugin`](./plugin.md) | 管理 OpenClaw 拦截插件 |
| [`stats`](./monitoring.md#stats) | 评估统计 |
| [`history`](./monitoring.md#history) | 最近的评估记录 |
| [`check`](./monitoring.md#check) | 手动评分命令 |
| [`blocking`](./monitoring.md#blocking) | 切换阻断模式 |
| [`model`](./monitoring.md#model) | LLM 模型管理 |
| [`approvals`](./monitoring.md#approvals) | 查看待审批请求 |
| [`memory`](./monitoring.md#memory) | 查看学习到的模式 |
| [`brief`](./monitoring.md#brief) | 安全记忆会话 |
| `version` | 打印版本号 |
| `help` | 显示帮助 |

## 命令别名

多个命令支持简写别名：

| 别名 | 命令 |
|------|------|
| `rs`, `r` | `restart` |
| `log`, `logs` | `history` |
| `models` | `model` |
| `block` | `blocking` |
| `analyze` | `check` |
| `pending` | `approvals` |
| `patterns` | `memory` |
| `buffer` | `brief` |
| `wizard` | `setup` |
| `upgrade` | `update` |
| `--version`, `-v` | `version` |
| `--help`, `-h` | `help` |

## 端口配置

默认情况下，GuardClaw 运行在 **3002** 端口。可以通过以下方式修改：

```bash
# 通过启动参数
guardclaw start --port 4000

# 通过环境变量
guardclaw config set PORT 4000

# 通过 .env 文件
echo "PORT=4000" >> .env
```

CLI 按照 `GUARDCLAW_PORT` → `PORT` → `3002` 的优先级读取端口。

## 热重载

所有通过 CLI 进行的配置更改都会**立即应用**到运行中的服务器 — 无需重启。包括 LLM 后端、审批模式、阈值、Token 等。

## 获取帮助

```bash
guardclaw help
guardclaw --help
guardclaw -h
```
