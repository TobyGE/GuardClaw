import Foundation

struct ServerStatus: Codable, Sendable {
    let connected: Bool?
    let backends: [String: BackendStatus]?
    let eventsCount: Int?
    let safeguardEnabled: Bool?
    let llmStatus: LLMStatus?
    let approvals: ApprovalStats?
    let failClosed: Bool?
    let healthy: Bool?
    let warnings: [StatusWarning]?
    let install: InstallInfo?
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
