import Foundation

struct ServerStatus: Codable, Sendable {
    let connected: Bool?
    let backends: [String: BackendStatus]?
    let eventsCount: Int?
    let safeguardEnabled: Bool?
    let llmStatus: LLMStatus?
    let blocking: BlockingInfo?
    let approvals: ApprovalStats?
    let failClosed: Bool?
    let healthy: Bool?
    let warnings: [StatusWarning]?
    let install: InstallInfo?
    let tokenUsage: TokenUsage?
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

struct AuditScanResponse: Codable, Sendable {
    let ok: Bool?
    let findings: [AuditFinding]
    let summary: AuditSummary?
    let error: String?
}

struct AuditSummary: Codable, Sendable {
    let total: Int?
    let bySeverity: [String: Int]?
    let byCategory: [String: Int]?
    let totalTools: Int?
    let totalSkills: Int?
    let dangerousTools: Int?
    let dangerousSkills: Int?
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
