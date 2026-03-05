import Foundation

/// Protocol for backend providers (Claude Code, OpenClaw, etc.)
protocol BackendProvider: Sendable {
    var id: String { get }
    var displayName: String { get }
    var backendKey: String { get }

    func filterApprovals(_ approvals: [ApprovalItem]) -> [ApprovalItem]
    func filterEvents(_ events: [EventItem]) -> [EventItem]
}

extension BackendProvider {
    func filterApprovals(_ approvals: [ApprovalItem]) -> [ApprovalItem] {
        approvals.filter { $0.backend == backendKey }
    }

    func filterEvents(_ events: [EventItem]) -> [EventItem] {
        events.filter { $0.sessionKey?.contains(backendKey) == true || $0.type?.contains(backendKey) == true }
    }
}
