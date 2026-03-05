import Foundation

struct EventItem: Codable, Identifiable, Sendable {
    let id: String?
    let type: String?
    let tool: String?
    let command: String?
    let text: String?
    let description: String?
    let sessionKey: String?
    let riskScore: Double?
    let timestamp: Double?
    let category: String?
    let allowed: Int?
    let safeguard: SafeguardInfo?

    var stableId: String { id ?? UUID().uuidString }

    /// Best display text for this event
    var displayText: String {
        command ?? tool ?? text ?? description ?? type ?? "Unknown"
    }

    /// Effective risk score from safeguard or top-level
    var effectiveRiskScore: Double {
        safeguard?.riskScore ?? riskScore ?? 0
    }

    /// Human-readable time ago string (timestamp is in milliseconds)
    var timeAgoText: String {
        guard let ts = timestamp else { return "" }
        let seconds = (Date().timeIntervalSince1970 * 1000 - ts) / 1000
        if seconds < 60 { return "\(Int(seconds))s ago" }
        if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
        if seconds < 86400 { return "\(Int(seconds / 3600))h ago" }
        return "\(Int(seconds / 86400))d ago"
    }
}

struct SafeguardInfo: Codable, Sendable {
    let riskScore: Double?
    let category: String?
    let reasoning: String?
    let allowed: Bool?
    let backend: String?
    let verdict: String?
}

struct EventHistoryResponse: Codable, Sendable {
    let events: [EventItem]
    let total: Int?
    let filter: String?
}
