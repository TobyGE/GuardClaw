# Roadmap

Current focus and planned features. For detailed notes see the [full roadmap document](https://github.com/TobyGE/GuardClaw/blob/main/docs/ROADMAP.md).

## In Progress

- **LoRA fine-tuning** — fine-tune Qwen3-4B on GuardClaw's own approve/deny history via QLoRA on Apple Silicon
- **Encrypted adapter distribution** — device-locked LoRA adapters via AES-256-GCM + hardware UUID binding
- **Cross-session tracking** — detect data read in session A and exfiltrated via session B

## Shipped

### Core Analysis
- ✅ Real-time tool event monitoring
- ✅ Risk scoring with local LLM (1–10 scale)
- ✅ Safe-tool fast path (skip LLM for obviously safe ops)
- ✅ Per-model prompt configs (qwen3, mistral, gpt-oss, etc.)
- ✅ Chained tool analysis (multi-step exfiltration detection)
- ✅ Write/edit path analysis (backdoor persistence detection)
- ✅ Tool result inspection (PII/secret scanning in outputs)
- ✅ Prompt injection defense on LLM judge
- ✅ Expanded secret detection (API keys, JWT, PEM, GitHub tokens)

### Post-Execution Audit
- ✅ File diff scanning via PostToolUse hook
- ✅ Taint tracking and pollution source identification
- ✅ Dashboard taint chain visualization

### Active Blocking
- ✅ OpenClaw plugin — pre-execution interception
- ✅ One-click blocking toggle
- ✅ Approval workflow (approve-last / deny-last)
- ✅ Run-level lock (one notification per run)
- ✅ Fail-closed on GuardClaw disconnect
- ✅ PID self-protection

### Dashboard & UX
- ✅ AI-powered event summaries
- ✅ Click-to-filter stats cards
- ✅ Light / dark mode
- ✅ Auto-open browser on start
- ✅ macOS menu bar app (GuardClawBar)

### Integration
- ✅ Claude Code, Codex CLI, Gemini CLI, OpenCode hooks
- ✅ OpenClaw WebSocket plugin
- ✅ GitHub Copilot CLI support
- ✅ Telegram / Discord / WhatsApp notifications
- ✅ Hot-reload all config changes (no restart needed)

### Memory & Learning
- ✅ Adaptive memory (approve/deny pattern store)
- ✅ Memory-based score adjustment
- ✅ Auto-approve by memory (high-confidence patterns)
- ✅ Human feedback buttons in dashboard
- ✅ Memory dashboard with pattern table
