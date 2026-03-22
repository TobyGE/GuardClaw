import Foundation

struct CopilotProvider: BackendProvider {
    let id = "copilot"
    let displayName = "Copilot CLI"
    let backendKey = "copilot"

    func filterEvents(_ events: [EventItem]) -> [EventItem] {
        events.filter { event in
            event.type?.hasPrefix("copilot") == true ||
            event.sessionKey?.hasPrefix("copilot:") == true
        }
    }
}
