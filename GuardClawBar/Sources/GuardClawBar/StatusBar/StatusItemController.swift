import AppKit
import SwiftUI

@MainActor
final class StatusItemController: NSObject {
    private let statusItem: NSStatusItem
    private let popover = NSPopover()
    private let appState: AppState
    private var eventMonitor: Any?
    private var iconTimer: Timer?
    private var lastIconStatus: IconStatus?
    private var lastBadgeCount: Int = -1

    init(appState: AppState) {
        self.appState = appState
        self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        super.init()
        setupButton()
        setupPopover()
        setupEventMonitor()
        observeState()
    }

    private func setupButton() {
        guard let button = statusItem.button else { return }
        // Set custom icon; fall back to SF Symbol if rendering fails
        let icon = IconRenderer.render(status: .normal, badgeCount: 0)
        if icon.size.width > 0 {
            button.image = icon
        } else {
            button.image = NSImage(systemSymbolName: "shield.checkered", accessibilityDescription: "GuardClaw")
        }
        button.target = self
        button.action = #selector(togglePopover)
    }

    private func setupPopover() {
        popover.contentSize = NSSize(width: 360, height: 520)
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(
            rootView: MenuPopoverView(appState: appState)
        )
    }

    private func setupEventMonitor() {
        eventMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            if let self, self.popover.isShown {
                self.popover.performClose(nil)
            }
        }
    }

    private func observeState() {
        // Observe icon status changes via a timer since @Observable
        // observation doesn't work directly outside SwiftUI views
        let state = appState
        let item = statusItem
        iconTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                let status = state.iconStatus
                let count = state.pendingCount
                // Only re-render when state actually changed
                guard status != self.lastIconStatus || count != self.lastBadgeCount else { return }
                self.lastIconStatus = status
                self.lastBadgeCount = count
                item.button?.image = IconRenderer.render(
                    status: status,
                    badgeCount: count
                )
            }
        }
    }

    @objc private func togglePopover() {
        if popover.isShown {
            popover.performClose(nil)
        } else if let button = statusItem.button {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            // Bring app to front
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    deinit {
        iconTimer?.invalidate()
        if let monitor = eventMonitor {
            NSEvent.removeMonitor(monitor)
        }
    }
}
