import Foundation

/// Caches AppState snapshots to disk for instant launch display.
struct StateCache {
    struct Snapshot: Codable {
        let serverStatus: ServerStatus?
        let recentFlagged: [EventItem]
        let backendFlagged: [String: [EventItem]]
        let recentEvents: [String: [EventItem]]
        let savedAt: Date
    }

    private static var cacheURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first!.appendingPathComponent("GuardClawBar")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("state-cache.json")
    }

    static func save(status: ServerStatus?, flaggedEvents: [EventItem], backendFlagged: [String: [EventItem]] = [:], recentEvents: [String: [EventItem]] = [:]) {
        let snapshot = Snapshot(
            serverStatus: status,
            recentFlagged: Array(flaggedEvents.prefix(20)),
            backendFlagged: backendFlagged.mapValues { Array($0.prefix(10)) },
            recentEvents: recentEvents.mapValues { Array($0.prefix(200)) },
            savedAt: Date()
        )
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: cacheURL, options: .atomic)
    }

    static func load() -> Snapshot? {
        guard let data = try? Data(contentsOf: cacheURL),
              let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data) else { return nil }
        // Discard cache older than 24 hours
        if snapshot.savedAt.timeIntervalSinceNow < -86400 { return nil }
        return snapshot
    }
}
