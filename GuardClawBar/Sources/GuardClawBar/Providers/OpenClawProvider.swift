import Foundation

struct OpenClawProvider: BackendProvider {
    let id = "openclaw"
    let displayName = "OpenClaw"
    let backendKey = "openclaw"

    func filterEvents(_ events: [EventItem]) -> [EventItem] {
        events.filter { event in
            event.type?.hasPrefix("openclaw") == true ||
            event.sessionKey?.contains("openclaw") == true
        }
    }
}
