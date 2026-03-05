import Foundation

struct ApprovalItem: Codable, Identifiable, Sendable {
    let id: String
    let toolName: String?
    let originalToolName: String?
    let displayInput: String?
    let riskScore: Double?
    let reason: String?
    let createdAt: Double?
    let elapsed: Double?
    let backend: String?
}

struct PendingApprovalsResponse: Codable, Sendable {
    let pending: [ApprovalItem]
    let count: Int?
}

struct ApprovalActionResponse: Codable, Sendable {
    let ok: Bool?
    let success: Bool?
    let approvalId: String?
    let action: String?
}
