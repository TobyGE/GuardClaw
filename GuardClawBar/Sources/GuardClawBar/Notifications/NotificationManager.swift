import UserNotifications
import AppKit

final class NotificationManager: @unchecked Sendable {
    /// Lazily initialized — UNUserNotificationCenter crashes without a proper .app bundle
    private var center: UNUserNotificationCenter? {
        guard Bundle.main.bundleIdentifier != nil else { return nil }
        return UNUserNotificationCenter.current()
    }

    private var isAvailable: Bool { center != nil }

    func requestPermission() {
        center?.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    func notifyNewApproval(_ approval: ApprovalItem) {
        guard let center else {
            // Fallback: use NSSound beep when no bundle (swift run)
            NSSound.beep()
            return
        }

        let content = UNMutableNotificationContent()
        content.title = "GuardClaw: Approval Needed"
        content.body = "\(approval.toolName ?? "Unknown tool") — Risk: \(Int(approval.riskScore ?? 0))/10"
        if let reason = approval.reason {
            content.body += "\n\(reason)"
        }
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "approval-\(approval.id)",
            content: content,
            trigger: nil
        )
        center.add(request)
    }
}
