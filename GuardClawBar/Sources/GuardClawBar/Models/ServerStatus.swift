import Foundation

struct ServerStatus: Codable, Sendable {
    let connected: Bool?
    let backends: [String: BackendStatus]?
    let eventsCount: Int?
    let eventCounts: EventCounts?
    let backendCounts: [String: EventCounts]?
    let safeguardEnabled: Bool?
    let llmStatus: LLMStatus?
    let blocking: BlockingInfo?
    let approvals: ApprovalStats?
    let failClosed: Bool?
    let healthy: Bool?
    let warnings: [StatusWarning]?
    let install: InstallInfo?
    let tokenUsage: TokenUsage?
    let agentTokens: AgentTokensMap?
}

struct EventCounts: Codable, Sendable {
    let total: Int?
    let safe: Int?
    let warn: Int?
    let blocked: Int?
}

struct AgentTokensMap: Codable, Sendable {
    let openclaw: AgentTokenPair?
    let claudeCode: AgentTokenPair?
    let codex: AgentTokenPair?

    enum CodingKeys: String, CodingKey {
        case openclaw
        case claudeCode = "claude-code"
        case codex
    }
}

struct AgentTokenPair: Codable, Sendable {
    let today: AgentTokenRecord?
    let cumulative: AgentTokenRecord?
}

struct AgentTokenRecord: Codable, Sendable {
    let input_tokens: Int?
    let output_tokens: Int?
    let cache_read: Int?
    let cache_write: Int?
    let requests: Int?

    var totalTokens: Int { (input_tokens ?? 0) + (output_tokens ?? 0) }
}

struct TokenUsage: Codable, Sendable {
    let promptTokens: Int?
    let completionTokens: Int?
    let totalTokens: Int?
    let requests: Int?
}

struct InstallInfo: Codable, Sendable {
    let daysSinceInstall: Int?
}

struct BackendStatus: Codable, Sendable {
    let connected: Bool?
    let label: String?
    let type: String?
}

struct LLMStatus: Codable, Sendable {
    let connected: Bool?
    let backend: String?
    let models: Int?
}

struct ApprovalStats: Codable, Sendable {
    let total: Int?
    let autoAllowed: Int?
    let autoBlocked: Int?
    let whitelisted: Int?
    let blacklisted: Int?
    let userApproved: Int?
    let userDenied: Int?
    let pending: Int?
    let mode: String?
}

struct BlockingInfo: Codable, Sendable {
    let enabled: Bool?
    let active: Bool?
    let mode: String?
}

struct StatusWarning: Codable, Sendable {
    let level: String?
    let message: String?
    let suggestion: String?
}

struct HealthResponse: Codable, Sendable {
    let ok: Bool
    let pid: Int?
    let ts: Double?
    let failClosed: Bool?
}

// MARK: - Models

struct ModelsResponse: Codable, Sendable {
    let models: [BuiltinModel]
}

struct BuiltinModel: Codable, Sendable, Identifiable {
    let id: String
    let name: String
    let description: String
    let size: String
    let recommended: Bool?
    let downloaded: Bool
    let incomplete: Bool?
    let downloading: Bool
    let progress: Int
    let loading: Bool
    let loaded: Bool
    let statusMessage: String?
    let setupError: String?
}

struct SetupResponse: Codable, Sendable {
    let status: String?
    let ok: Bool?
    let modelId: String?
    let path: String?
}

struct CCSetupStatus: Codable, Sendable {
    let installed: Bool
    let path: String?
}

struct LLMConfigResponse: Codable, Sendable {
    let success: Bool?
    let message: String?
}

struct ExternalModelsResponse: Codable, Sendable {
    let models: [String]?
    let error: String?
}

struct RuleSuggestionsResponse: Codable, Sendable {
    let suggestions: [RuleSuggestion]
}

struct RuleSuggestion: Codable, Sendable, Identifiable {
    let type: String // "whitelist" or "blacklist"
    let pattern: String
    let toolName: String?
    let reason: String
    let approveCount: Int?
    let denyCount: Int?
    let confidence: Double?
    let source: String? // "llm" if AI-generated

    var id: String { "\(type):\(pattern)" }
    var isAI: Bool { source == "llm" }
}

// MARK: - Audit

struct AuditScanProgress: Codable, Sendable {
    let phase: String?    // "idle", "scanning", "llm-review", "done"
    let current: Int?
    let total: Int?
    let message: String?
}

struct AuditScanResponse: Codable, Sendable {
    let ok: Bool?
    let findings: [AuditFinding]
    let summary: AuditSummary?
    let error: String?
    let configChanged: Bool?
}

struct AuditSummary: Codable, Sendable {
    let total: Int?
    let bySeverity: [String: Int]?
    let byCategory: [String: Int]?
    let totalTools: Int?
    let totalSkills: Int?
    let dangerousTools: Int?
    let dangerousSkills: Int?
    let dangerousToolList: [String]?
    let dangerousSkillList: [String]?
    let vulnerabilities: Int?
}

struct AuditFinding: Codable, Sendable, Identifiable {
    let ruleId: String?
    let title: String?
    let description: String?
    let severity: String?
    let category: String?
    let confidence: Double?
    let tier: String?
    let filePath: String?
    let line: Int?
    let snippet: String?
    let remediation: String?
    let cweId: String?
    let owaspId: String?
    let scanTarget: String?
    let source: String?       // "Claude Official Plugin", "External Plugin", "Claude Config"
    let sourceName: String?   // plugin name e.g. "skill-creator"
    let skillName: String?    // skill name if applicable
    let llmVerdict: String?   // "TRUE_RISK", "FALSE_POSITIVE", "NEEDS_REVIEW"
    let llmConfidence: Double?
    let llmExplanation: String?

    var id: String { "\(ruleId ?? ""):\(filePath ?? ""):\(line ?? 0)" }

    var severityColor: String {
        switch severity {
        case "critical": return "red"
        case "high": return "orange"
        case "medium": return "yellow"
        default: return "gray"
        }
    }
}

struct TokenDetectResponse: Codable, Sendable {
    let token: String?
    let source: String?
}

struct GenericResponse: Codable, Sendable {
    let success: Bool?
    let message: String?
}

struct BlockingToggleResponse: Codable, Sendable {
    let ok: Bool?
    let enabled: Bool?
}

struct FailClosedResponse: Codable, Sendable {
    let ok: Bool?
    let failClosed: Bool?
}

// MARK: - Cloud Judge

struct CloudJudgeProviderInfo: Codable, Sendable, Identifiable {
    let id: String
    let displayName: String
    let defaultModel: String
    let connected: Bool
    let oauthSupported: Bool?
}

struct CloudJudgeConfig: Codable, Sendable {
    let enabled: Bool
    let provider: String
    let model: String
    let isConfigured: Bool
    let judgeMode: String?
    let providers: [CloudJudgeProviderInfo]?
}

struct CloudJudgeTestResponse: Codable, Sendable {
    let success: Bool
    let error: String?
    let result: CloudJudgeTestResult?
}

struct CloudJudgeTestResult: Codable, Sendable {
    let verdict: String?
    let reasoning: String?
}
