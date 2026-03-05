import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItemController: StatusItemController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Hide from Dock, show only in menu bar
        NSApp.setActivationPolicy(.accessory)

        // Start embedded backend if available
        BackendManager.shared.start()

        let appState = AppState()
        statusItemController = StatusItemController(appState: appState)
        appState.startPolling()
    }

    func applicationWillTerminate(_ notification: Notification) {
        BackendManager.shared.stop()
    }
}
