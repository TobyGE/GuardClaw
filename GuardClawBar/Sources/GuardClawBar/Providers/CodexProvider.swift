import Foundation

struct CodexProvider: BackendProvider {
    let id = "codex"
    let displayName = "Codex CLI"
    let backendKey = "codex"

    func filterEvents(_ events: [EventItem]) -> [EventItem] {
        events.filter { event in
            event.type?.hasPrefix("codex") == true ||
            event.sessionKey?.hasPrefix("codex:") == true
        }
    }
}
