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

    // Events
    var recentEvents: [EventItem] = []

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

    var todayEventCount: Int { serverStatus?.eventsCount ?? 0 }

    /// Only count tool events (not prompts/text) for risk stats
    private var toolEvents: [EventItem] {
        recentEvents.filter { $0.type?.contains("tool") == true }
    }

    var safeCount: Int {
        toolEvents.filter { $0.effectiveRiskScore < 6 }.count
    }

    var warnCount: Int {
        toolEvents.filter {
            $0.effectiveRiskScore >= 6 && $0.effectiveRiskScore < 9
        }.count
    }

    var blockCount: Int {
        toolEvents.filter { $0.effectiveRiskScore >= 9 }.count
    }

    var highRiskEvents: [EventItem] {
        recentEvents
            .filter { $0.effectiveRiskScore >= 7 }
            .prefix(5)
            .map { $0 }
    }

    // MARK: - Backend status helpers

    func backendStatus(for key: String) -> BackendStatus? {
        serverStatus?.backends?[key]
    }

    func approvalsForBackend(_ key: String) -> [ApprovalItem] {
        pendingApprovals.filter { $0.backend == key }
    }

    func eventsForBackend(_ key: String) -> [EventItem] {
        let provider = providers.first { $0.backendKey == key }
        return provider?.filterEvents(recentEvents) ?? recentEvents
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
            // Fetch status + approvals + events concurrently
            async let statusResult = api.status()
            async let approvalsResult = api.pendingApprovals()
            async let eventsResult = api.eventHistory(limit: 30)

            let s = try await statusResult
            let a = try await approvalsResult
            let e = try await eventsResult

            let previousPendingIds = Set(pendingApprovals.map(\.id))

            serverStatus = s
            pendingApprovals = a.pending
            recentEvents = e.events
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
            // Remove from local list immediately
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
