import Foundation

struct CursorProvider: BackendProvider {
    let id = "cursor"
    let displayName = "Cursor"
    let backendKey = "cursor"

    func filterEvents(_ events: [EventItem]) -> [EventItem] {
        events.filter { event in
            event.type?.hasPrefix("cursor") == true ||
            event.sessionKey?.hasPrefix("cursor:") == true
        }
    }
}
