import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var statusItemController: StatusItemController?
    private(set) var appState: AppState?
    private var mainWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Hide from Dock, show only in menu bar
        NSApp.setActivationPolicy(.accessory)

        // Start embedded backend if available
        BackendManager.shared.start()

        let state = AppState()
        appState = state
        statusItemController = StatusItemController(appState: state)
        state.startPolling()

        // Show onboarding on first launch
        if !SettingsStore.shared.hasCompletedOnboarding {
            openDashboard(showOnboarding: true)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        BackendManager.shared.stop()
    }

    // MARK: - Dashboard Window

    func openDashboard(showOnboarding: Bool = false) {
        if let window = mainWindow, window.isVisible {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        guard let state = appState else { return }

        let contentView = MainContentView(showOnboarding: showOnboarding)
            .environment(state)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1060, height: 700),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.center()
        window.title = "GuardClaw"
        window.titlebarAppearsTransparent = false
        window.minSize = NSSize(width: 800, height: 560)
        window.contentViewController = NSHostingController(rootView: contentView)
        window.setFrameAutosaveName("GuardClawDashboard")
        // Restore saved frame, but enforce minimum good size if none saved yet
        if window.frame.size.width < 800 || window.frame.size.height < 560 {
            window.setContentSize(NSSize(width: 1060, height: 700))
            window.center()
        }
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        NSApp.setActivationPolicy(.regular)

        mainWindow = window
    }

    // MARK: - NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        guard (notification.object as? NSWindow) === mainWindow else { return }
        // Return to menu-bar-only mode when dashboard closes
        NSApp.setActivationPolicy(.accessory)
    }
}
