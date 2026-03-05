import Foundation

struct ClaudeCodeProvider: BackendProvider {
    let id = "claude-code"
    let displayName = "Claude Code"
    let backendKey = "claude-code"

    func filterEvents(_ events: [EventItem]) -> [EventItem] {
        events.filter { event in
            event.type?.hasPrefix("claude-code") == true ||
            event.sessionKey?.contains("claude") == true ||
            // Include events that aren't explicitly from another backend
            (event.backend == nil && event.type != "openclaw-tool")
        }
    }
}

private extension EventItem {
    var backend: String? {
        // Infer backend from event type or session key
        if type?.hasPrefix("claude-code") == true { return "claude-code" }
        if type?.hasPrefix("openclaw") == true { return "openclaw" }
        return nil
    }
}
