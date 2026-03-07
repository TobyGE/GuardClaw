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
        command ?? description ?? text ?? tool ?? type ?? "Unknown"
    }

    /// Effective risk score from safeguard or top-level
    var effectiveRiskScore: Double {
        safeguard?.riskScore ?? riskScore ?? 0
    }

    /// Human-readable time string (timestamp is in milliseconds)
    /// Today: shows HH:mm:ss, otherwise: Xd ago
    var timeAgoText: String {
        guard let ts = timestamp else { return "" }
        let eventDate = Date(timeIntervalSince1970: ts / 1000)
        let fmt = DateFormatter()
        if Calendar.current.isDateInToday(eventDate) {
            fmt.dateFormat = "HH:mm:ss"
        } else {
            fmt.dateFormat = "MM/dd HH:mm"
        }
        return fmt.string(from: eventDate)
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
