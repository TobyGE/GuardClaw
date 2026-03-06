import Foundation

struct MemoryStatsResponse: Codable, Sendable {
    let totalDecisions: Int?
    let patterns: Int?
    let approveRate: Double?
    let autoApprovePatterns: Int?
    let recentDecisions: Int?
}

struct MemoryPatternsResponse: Codable, Sendable {
    let patterns: [MemoryPattern]
}

struct MemoryPattern: Codable, Identifiable, Sendable {
    let tool: String?
    let commandPattern: String?
    let approveCount: Int?
    let denyCount: Int?
    let confidence: Double?
    let suggestedAction: String?
    let lastSeen: Double?

    var id: String { "\(tool ?? ""):\(commandPattern ?? "")" }

    var isAutoApprove: Bool { suggestedAction == "auto-approve" }
    var total: Int { (approveCount ?? 0) + (denyCount ?? 0) }
    var approveRate: Double {
        guard total > 0 else { return 0 }
        return Double(approveCount ?? 0) / Double(total)
    }
}
