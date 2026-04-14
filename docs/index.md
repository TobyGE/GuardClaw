---
layout: home

hero:
  name: GuardClaw
  text: AI Agent Safety Monitor
  tagline: Risk-scores every tool call before execution. Blocks dangerous ones. Stays out of the way on the rest.
  image:
    src: /screenshots/dashboard-overview-2026-03.png
    alt: GuardClaw Dashboard
  actions:
    - theme: brand
      text: Get Started
      link: /guide/quick-start
    - theme: alt
      text: View on GitHub
      link: https://github.com/TobyGE/GuardClaw

features:
  - icon: 🛡️
    title: Real-time Risk Scoring
    details: Every tool call scored 1–10 by a local or cloud LLM judge before execution. Safe ops get a fast pass. Dangerous ones get blocked.
  - icon: ⚡
    title: Zero Friction on Safe Ops
    details: Built-in fast paths skip the LLM for git, npm, read-only commands, and other obviously safe operations. No added latency for 80% of tool calls.
  - icon: 🔒
    title: 100% Local by Default
    details: Runs entirely on your machine using LM Studio, Ollama, or the built-in MLX engine. No cloud account needed. Your code never leaves.
  - icon: 🤖
    title: Works with 7 Agents
    details: Claude Code, Codex CLI, Gemini CLI, OpenCode, OpenClaw, Cursor, and GitHub Copilot CLI — all supported out of the box.
  - icon: 🧠
    title: Learns from You
    details: Adaptive memory records every approve/deny decision. Patterns you approve repeatedly are auto-allowed. Your judgment improves the system.
  - icon: 🔗
    title: Multi-step Attack Detection
    details: Chain analysis tracks sequences across tool calls — catching attacks like read ~/.ssh/id_rsa → curl evil.com that look harmless in isolation.
---

## We'd Love Your Feedback

GuardClaw is early and we're actively listening. Whether you hit a bug, want a feature, got stuck on setup, or just want to say something works well — **[open a GitHub issue](https://github.com/TobyGE/GuardClaw/issues/new)**. Every piece of feedback shapes the next release.

No template, no sign-up hoops — just tell us what's on your mind at [github.com/TobyGE/GuardClaw/issues](https://github.com/TobyGE/GuardClaw/issues).
