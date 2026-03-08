import Foundation

struct GeminiCLIProvider: BackendProvider {
    let id = "gemini-cli"
    let displayName = "Gemini CLI"
    let backendKey = "gemini-cli"

    func filterEvents(_ events: [EventItem]) -> [EventItem] {
        events.filter { event in
            event.type?.hasPrefix("gemini") == true ||
            event.sessionKey?.hasPrefix("gemini:") == true
        }
    }
}
