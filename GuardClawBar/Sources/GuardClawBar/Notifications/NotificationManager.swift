import UserNotifications
import AppKit

// Notification category used for model-ready taps
let kModelReadyNotificationCategory = "MODEL_READY"
let kModelReadyNotificationAction = "OPEN_JUDGE"

final class NotificationManager: @unchecked Sendable {
    /// Lazily initialized — UNUserNotificationCenter crashes without a proper .app bundle
    private var center: UNUserNotificationCenter? {
        guard Bundle.main.bundleIdentifier != nil else { return nil }
        return UNUserNotificationCenter.current()
    }

    private var isAvailable: Bool { center != nil }

    func requestPermission() {
        guard let center else { return }
        let openAction = UNNotificationAction(
            identifier: kModelReadyNotificationAction,
            title: "Open Judge Settings",
            options: [.foreground]
        )
        let category = UNNotificationCategory(
            identifier: kModelReadyNotificationCategory,
            actions: [openAction],
            intentIdentifiers: [],
            options: []
        )
        center.setNotificationCategories([category])
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    func notifyModelDownloaded(modelName: String) {
        guard let center else { return }
        let content = UNMutableNotificationContent()
        content.title = "Model downloaded"
        content.body = "\(modelName) is ready to load. Tap to open Judge settings."
        content.sound = .default
        content.categoryIdentifier = kModelReadyNotificationCategory
        let request = UNNotificationRequest(
            identifier: "model-downloaded-\(modelName)",
            content: content,
            trigger: nil
        )
        center.add(request)
    }

    func notifyNewApproval(_ approval: ApprovalItem) {
        let title = "GuardClaw: Approval Needed"
        var body = "\(approval.toolName ?? "Unknown tool") — Risk: \(Int(approval.riskScore ?? 0))/10"
        if let reason = approval.reason {
            body += "\n\(reason)"
        }

        if let center {
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default

            let request = UNNotificationRequest(
                identifier: "approval-\(approval.id)",
                content: content,
                trigger: nil
            )
            center.add(request)
        } else {
            sendOSANotification(title: title, body: body)
        }
    }

    func notifyHighRiskEvent(_ event: EventItem) {
        let score = event.effectiveRiskScore
        guard score >= 8 else { return }

        let backend = event.safeguard?.backend ?? "unknown"
        let tool = event.tool ?? event.type ?? "unknown"
        let blocked = event.allowed == 0

        let title = blocked
            ? "GuardClaw: BLOCKED [\(backend)]"
            : "GuardClaw: High Risk [\(backend)]"
        var body = "\(tool): \(event.displayText)"
        if let reasoning = event.safeguard?.reasoning {
            body += "\n\(String(reasoning.prefix(200)))"
        }

        if let center {
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = blocked ? .defaultCritical : .default

            let request = UNNotificationRequest(
                identifier: "risk-\(event.stableId)",
                content: content,
                trigger: nil
            )
            center.add(request)
        } else {
            // Fallback: osascript notification for debug builds without bundle ID
            sendOSANotification(title: title, body: body)
        }
    }

    /// Fallback notification via osascript (works without bundle ID)
    private func sendOSANotification(title: String, body: String) {
        let safeTitle = title.replacingOccurrences(of: "\"", with: "\\\"")
        let safeBody = body.prefix(200).replacingOccurrences(of: "\"", with: "\\\"")
        let script = "display notification \"\(safeBody)\" with title \"\(safeTitle)\""
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        try? process.run()
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
