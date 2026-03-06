import Foundation
import SwiftUI

@Observable
@MainActor
final class AppState {
    // Connection
    var isConnected = false
    var serverStatus: ServerStatus?

    // Approvals
    var pendingApprovals: [ApprovalItem] = []
    var pendingCount: Int { pendingApprovals.count }

    // Per-backend events (fetched server-side with backend= param)
    var ccEvents: [EventItem] = []
    var ocEvents: [EventItem] = []

    // Icon
    var iconStatus: IconStatus {
        if !isConnected { return .error }
        if pendingCount > 0 { return .pending }
        return .normal
    }

    // UI state
    var selectedTab: String = "claude-code"
    var isPolling = false
    var lastError: String?

    // Providers
    let providers: [any BackendProvider] = [ClaudeCodeProvider(), OpenClawProvider()]

    // Internals
    private let api = GuardClawAPI()
    private var pollTask: Task<Void, Never>?
    private let notificationManager = NotificationManager()

    // MARK: - Stats helpers

    var totalEventCount: Int { serverStatus?.eventsCount ?? 0 }
    var daysProtected: Int { serverStatus?.install?.daysSinceInstall ?? 0 }

    /// Green if any agent connected, gray if server up but no agents, red if server down
    var connectionDotColor: Color {
        guard isConnected, let backends = serverStatus?.backends else { return .gray }
        let anyAgentConnected = backends.values.contains { $0.connected == true }
        return anyAgentConnected ? .green : .gray
    }

    func eventsForBackend(_ key: String) -> [EventItem] {
        switch key {
        case "claude-code": return ccEvents
        case "openclaw": return ocEvents
        default: return []
        }
    }

    // MARK: - Backend status helpers

    func backendStatus(for key: String) -> BackendStatus? {
        serverStatus?.backends?[key]
    }

    func approvalsForBackend(_ key: String) -> [ApprovalItem] {
        pendingApprovals.filter { $0.backend == key }
    }

    // MARK: - Polling

    func startPolling() {
        guard !isPolling else { return }
        isPolling = true
        notificationManager.requestPermission()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.poll()
                let interval = SettingsStore.shared.pollInterval
                try? await Task.sleep(for: .seconds(interval))
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
        isPolling = false
    }

    private func poll() async {
        do {
            // Fetch all data concurrently, using server-side backend filtering
            async let statusResult = api.status()
            async let approvalsResult = api.pendingApprovals()
            async let ccResult = api.eventHistory(limit: 999999, backend: "claude-code")
            async let ocResult = api.eventHistory(limit: 999999, backend: "openclaw")

            let s = try await statusResult
            let a = try await approvalsResult
            let cc = try await ccResult
            let oc = try await ocResult

            let previousPendingIds = Set(pendingApprovals.map(\.id))

            serverStatus = s
            pendingApprovals = a.pending
            ccEvents = cc.events
            ocEvents = oc.events
            isConnected = true
            lastError = nil

            // Notify for new approvals
            let newApprovals = a.pending.filter { !previousPendingIds.contains($0.id) }
            for approval in newApprovals {
                notificationManager.notifyNewApproval(approval)
            }
        } catch {
            isConnected = false
            lastError = error.localizedDescription
        }
    }

    // MARK: - Approval Actions

    func approve(id: String, backend: String?) async {
        do {
            if backend == "openclaw" {
                let _: ApprovalActionResponse = try await api.resolveOpenClaw(approvalId: id, action: "allow-once")
            } else {
                let _: ApprovalActionResponse = try await api.approve(id: id)
            }
            pendingApprovals.removeAll { $0.id == id }
        } catch {
            lastError = "Approve failed: \(error.localizedDescription)"
        }
    }

    func deny(id: String, backend: String?) async {
        do {
            if backend == "openclaw" {
                let _: ApprovalActionResponse = try await api.resolveOpenClaw(approvalId: id, action: "deny")
            } else {
                let _: ApprovalActionResponse = try await api.deny(id: id)
            }
            pendingApprovals.removeAll { $0.id == id }
        } catch {
            lastError = "Deny failed: \(error.localizedDescription)"
        }
    }
}
