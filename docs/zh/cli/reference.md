# CLI 命令参考

## 核心命令

```bash
guardclaw start           # 启动服务器（自动打开控制台）
guardclaw start -f        # 前台启动（Ctrl-C 停止）
guardclaw stop            # 停止服务器
guardclaw status          # 查看服务器和评分引擎状态
guardclaw setup           # 重新运行交互式配置向导
guardclaw update          # 更新到最新版本（自动停止/重启服务器）
```

## 配置命令

```bash
guardclaw config llm              # 交互式 LLM 后端选择
guardclaw config mode             # 设置审批模式
guardclaw config thresholds       # 设置风险分数阈值
guardclaw config show             # 查看当前配置
guardclaw config set KEY VALUE    # 设置单个环境变量（立即生效）

guardclaw config set-token <token>          # 设置 OpenClaw 网关 Token
guardclaw config detect-token --save        # 自动检测并保存 Token
```

### 常用 `config set` 键名

```bash
# 切换后端
guardclaw config set SAFEGUARD_BACKEND openrouter

# 设置审批模式
guardclaw config set GUARDCLAW_APPROVAL_MODE prompt

# 调整阈值
guardclaw config set GUARDCLAW_AUTO_ALLOW_THRESHOLD 5
guardclaw config set GUARDCLAW_AUTO_BLOCK_THRESHOLD 8
```

所有配置更改立即应用到运行中的服务器，**无需重启**。

## 插件管理

```bash
guardclaw plugin install    # 安装 OpenClaw 拦截插件
guardclaw plugin status     # 查看插件状态
```

## Hook 安装（Claude Code）

```bash
node scripts/install-claude-code.js              # 安装 Hook
node scripts/install-claude-code.js --uninstall  # 卸载 Hook
```

## 手动风险评分

```bash
guardclaw check "rm -rf /tmp/build"   # 手动评分某条命令
```

## 选项说明

| 参数 | 命令 | 说明 |
|------|------|------|
| `-f`, `--foreground` | `start` | 前台运行（不守护进程化）|
| `--no-open` | `start` | 启动时不自动打开浏览器 |
| `--save` | `config detect-token` | 将检测到的 Token 保存到配置文件 |
