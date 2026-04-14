---
layout: home

hero:
  name: GuardClaw
  text: AI Agent 安全监控
  tagline: 对每一个工具调用进行实时风险评分，拦截危险操作，对安全操作零干扰。
  image:
    src: /screenshots/dashboard-overview-2026-03.png
    alt: GuardClaw 控制台
  actions:
    - theme: brand
      text: 快速开始
      link: /zh/guide/quick-start
    - theme: alt
      text: 查看源码
      link: https://github.com/TobyGE/GuardClaw

features:
  - icon: 🛡️
    title: 实时风险评分
    details: 每次工具调用在执行前由本地或云端 LLM 评分（1–10 分），安全操作直接放行，危险操作自动拦截。
  - icon: ⚡
    title: 安全操作零延迟
    details: 内置快速通道规则跳过 LLM，对 git、npm、只读操作等明显安全的命令直接放行，80% 的工具调用无额外延迟。
  - icon: 🔒
    title: 默认 100% 本地运行
    details: 使用 LM Studio、Ollama 或内置 MLX 引擎，完全在本机运行。无需云账号，代码不出本机。
  - icon: 🤖
    title: 支持 7 款主流 Agent
    details: Claude Code、Codex CLI、Gemini CLI、OpenCode、OpenClaw、Cursor、GitHub Copilot CLI，开箱即用。
  - icon: 🧠
    title: 从使用中持续学习
    details: 自适应记忆系统记录每次审批/拒绝决策。频繁被审批的操作会自动放行，让判断越来越准。
  - icon: 🔗
    title: 多步攻击检测
    details: 链式分析跨工具调用追踪序列，能识别孤立看似无害但组合危险的攻击，如 read ~/.ssh/id_rsa → curl evil.com。
---

## 欢迎反馈

GuardClaw 还很年轻，我们认真听取每一条反馈。无论是遇到 Bug、想要新功能、卡在配置上，还是单纯想说某个功能好用 —— **[在 GitHub 上开一个 Issue](https://github.com/TobyGE/GuardClaw/issues/new)** 就行。每一条反馈都会影响下一个版本。

不需要模板，不用注册，直接说你想说的：[github.com/TobyGE/GuardClaw/issues](https://github.com/TobyGE/GuardClaw/issues)。
