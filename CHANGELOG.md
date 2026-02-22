# Changelog

## v0.2.0 (2026-02-22)

### New: Chained Tool Analysis
- **`after_tool_call` hook integration** — GuardClaw now captures real tool outputs via OpenClaw's native `after_tool_call` plugin hook (no OpenClaw code changes required)
- **Session tool history** — each session maintains a rolling window of the last 10 tool calls including inputs + outputs, stored in `toolHistoryStore`
- **Chain-aware LLM analysis** — when an "exit-type" tool (`message`, `sessions_send`, `sessions_spawn`, `exec`) is called after sensitive history (SSH keys, `.env` files, external content), the full session history is appended to the LLM prompt for holistic risk assessment
- **`chainRisk` flag** — LLM returns `chainRisk: true/false` in addition to per-step `riskScore`; chain risk is reflected in the block notification and UI
- **UI: tool output display** — `ToolCallRow` now shows an expandable "Output" section with the actual tool result (truncated at 300 chars with "show more")
- **UI: `⛓️ chain` badge** — tool calls flagged with chain risk show a purple `⛓️ chain` badge in the dashboard

### Technical
- New server endpoint: `POST /api/tool-result` — receives tool results from plugin after execution
- `safeguard.js`: `buildChainContextSection(history)`, `analyzeToolAction(action, chainHistory)`, `analyzeCommand(command, chainHistory)`
- Plugin: `pendingResultKeys` Map correlates `before_tool_call` (has `sessionKey`) with `after_tool_call` (context has `sessionKey: undefined`)
- Chain-aware results are not cached (session-specific context)
- Fast-path bypass when `chainHistory` is present (a "safe" command can be dangerous in context)



All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial repository setup with complete GitHub structure
- Custom Clawdbot skills for Notion integration
- GuardClaw chatbot sub-project
- Memory system for context persistence
- Automation scripts for paper tracking and study planning

### Skills
- **notion-earnings-tracker** - Track company earnings reports in Notion
- **notion-screenshot-tracker** - Auto-catalog research paper screenshots

### Documentation
- Comprehensive README with project overview
- Contributing guidelines
- Issue and PR templates
- MIT License

## [1.0.0] - 2025-02-10

### Initial Release
- Configured Clawdbot workspace
- AI assistant with custom personality (SOUL.md)
- User context and preferences (USER.md)
- Agent identity configuration (IDENTITY.md)
- Workspace behavior guidelines (AGENTS.md)

---

## Release Notes Format

### Added
New features and capabilities

### Changed
Changes to existing functionality

### Deprecated
Soon-to-be removed features

### Removed
Removed features

### Fixed
Bug fixes

### Security
Security improvements and fixes
