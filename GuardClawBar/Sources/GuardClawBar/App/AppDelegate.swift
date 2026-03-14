import AppKit
import SwiftUI
import UserNotifications

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, UNUserNotificationCenterDelegate {
    static var shared: AppDelegate?
    private var statusItemController: StatusItemController?
    private(set) var appState: AppState?
    private var mainWindow: NSWindow?
    private var progressPanelController: ModelDownloadPanelController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        AppDelegate.shared = self
        // Hide from Dock, show only in menu bar
        NSApp.setActivationPolicy(.accessory)
        BackendManager.shared.start()

        let state = AppState()
        appState = state
        statusItemController = StatusItemController(appState: state)
        state.startPolling()

        // Set up notifications (may fail in debug builds without a proper app bundle)
        if Bundle.main.bundleIdentifier != nil {
            let nm = NotificationManager()
            nm.requestPermission()
            UNUserNotificationCenter.current().delegate = self
        }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(showProgressPanel(_:)),
            name: .guardclawModelSetupStarted,
            object: nil
        )

        // Show onboarding on first launch, otherwise auto-open dashboard
        if !SettingsStore.shared.hasCompletedOnboarding {
            openDashboard(showOnboarding: true)
        } else {
            openDashboard()
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
        if window.frame.size.width < 800 || window.frame.size.height < 560 {
            window.setContentSize(NSSize(width: 1060, height: 700))
            window.center()
        }
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        NSApp.setActivationPolicy(.regular)
        NSApp.applicationIconImage = IconRenderer.renderAppIcon(size: 256)

        mainWindow = window
    }

    // MARK: - Progress Panel

    @objc private func showProgressPanel(_ notification: Notification) {
        guard let modelId = notification.object as? String else { return }

        Task { @MainActor in
            let api = GuardClawAPI()
            let modelName: String
            if let resp = try? await api.listModels(),
               let model = resp.models.first(where: { $0.id == modelId }) {
                modelName = model.name
            } else {
                modelName = modelId
            }

            progressPanelController?.close()
            let controller = ModelDownloadPanelController(modelId: modelId, modelName: modelName)
            progressPanelController = controller
            controller.showWindow(nil)
        }
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let categoryId = response.notification.request.content.categoryIdentifier
        if categoryId == kModelReadyNotificationCategory {
            Task { @MainActor in
                appState?.navigateTo = .judge
                openDashboard()
            }
        }
        completionHandler()
    }

    // MARK: - NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        guard (notification.object as? NSWindow) === mainWindow else { return }
        NSApp.setActivationPolicy(.accessory)
    }
}
