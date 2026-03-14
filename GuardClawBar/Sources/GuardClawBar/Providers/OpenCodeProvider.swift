import Foundation

struct OpenCodeProvider: BackendProvider {
    let id = "opencode"
    let displayName = "OpenCode"
    let backendKey = "opencode"

    func filterEvents(_ events: [EventItem]) -> [EventItem] {
        events.filter { event in
            event.type?.hasPrefix("opencode") == true ||
            event.sessionKey?.hasPrefix("opencode:") == true
        }
    }
}
