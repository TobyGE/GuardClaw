import Foundation

struct MemoryStatsResponse: Codable, Sendable {
    let totalDecisions: Int?
    let totalPatterns: Int?
    let approves: Int?
    let denies: Int?
    let approveRate: String?
    let autoApproveCount: Int?
}

struct MemoryPatternsResponse: Codable, Sendable {
    let patterns: [MemoryPattern]
}

struct MemoryPattern: Codable, Identifiable, Sendable {
    let id: Int
    let pattern: String?
    let toolName: String?
    let approveCount: Int?
    let denyCount: Int?
    let confidence: Double?
    let suggestedAction: String?
    let lastSeen: Double?

    var tool: String? { toolName }
    var commandPattern: String? { pattern }

    var isAutoApprove: Bool { suggestedAction == "auto-approve" }
    var total: Int { (approveCount ?? 0) + (denyCount ?? 0) }
    var approveRate: Double {
        guard total > 0 else { return 0 }
        return Double(approveCount ?? 0) / Double(total)
    }
}
