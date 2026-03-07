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

    func notifyScanComplete(findings: Int) {
        guard let center else { return }

        let content = UNMutableNotificationContent()
        if findings > 0 {
            content.title = "GuardClaw: Security Scan Complete"
            content.body = "\(findings) potential issue\(findings == 1 ? "" : "s") found. Tap to review."
            content.sound = .default
        } else {
            content.title = "GuardClaw: Security Scan Complete"
            content.body = "No security concerns found. Your agent configuration looks clean."
        }

        let request = UNNotificationRequest(
            identifier: "scan-complete-\(Date().timeIntervalSince1970)",
            content: content,
            trigger: nil
        )
        center.add(request)
    }
}
