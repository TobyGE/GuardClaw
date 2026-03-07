import Foundation
import SwiftUI

@Observable
@MainActor
final class AppState {
    // Connection
    var isConnected = false
    var serverStatus: ServerStatus?

    // Per-backend events (fetched server-side with backend= param)
    var ccEvents: [EventItem] = []
    var ocEvents: [EventItem] = []

    // Approvals
    var pendingApprovals: [ApprovalItem] = []
    var pendingCount: Int { pendingApprovals.count }

    // Blocking/Rules
    var blockingStatus: BlockingStatusResponse?

    // Security Scan
    var auditSummary: AuditSummary?

    // Icon
    var iconStatus: IconStatus {
        if !isConnected { return .idle }
        if pendingCount > 0 { return .pending }
        let anyAgent = serverStatus?.backends?.values.contains { $0.connected == true } ?? false
        return anyAgent ? .normal : .idle
    }

    // UI state
    var selectedTab: String = "claude-code"
    var isPolling = false
    var lastError: String?

    // Providers
    let providers: [any BackendProvider] = [ClaudeCodeProvider(), OpenClawProvider()]

    // Internals
    let api = GuardClawAPI()
    private var pollTask: Task<Void, Never>?
    private var sseTask: Task<Void, Never>?
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
        startSSE()
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
        sseTask?.cancel()
        sseTask = nil
        isPolling = false
    }

    // MARK: - SSE

    func startSSE() {
        sseTask?.cancel()
        sseTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.connectSSE()
                // Backoff before reconnect
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    private func connectSSE() async {
        guard let url = URL(string: "\(SettingsStore.shared.serverURL)/api/events") else { return }
        let client = SSEClient(url: url)
        for await event in await client.events() {
            guard !Task.isCancelled else { break }
            await handleSSEEvent(event)
        }
    }

    private func handleSSEEvent(_ event: SSEEvent) async {
        guard let data = event.data.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        let type = json["type"] as? String ?? ""

        switch type {
        case "tool-call", "tool_call", "event":
            // Refresh events list
            if let eventData = try? JSONDecoder().decode(EventItem.self, from: data) {
                let backend = eventData.safeguard?.backend ?? "claude-code"
                if backend == "openclaw" {
                    if !ocEvents.contains(where: { $0.id == eventData.id }) {
                        ocEvents.insert(eventData, at: 0)
                        if ocEvents.count > 500 { ocEvents = Array(ocEvents.prefix(500)) }
                    }
                } else {
                    if !ccEvents.contains(where: { $0.id == eventData.id }) {
                        ccEvents.insert(eventData, at: 0)
                        if ccEvents.count > 500 { ccEvents = Array(ccEvents.prefix(500)) }
                    }
                }
            }
        case "approval-request", "approval_request":
            // Fetch fresh approvals
            if let resp = try? await api.pendingApprovals() {
                let previousIds = Set(pendingApprovals.map(\.id))
                pendingApprovals = resp.pending
                let newApprovals = resp.pending.filter { !previousIds.contains($0.id) }
                for approval in newApprovals {
                    notificationManager.notifyNewApproval(approval)
                }
            }
        case "approval-resolved", "approval_resolved":
            if let id = (json["data"] as? [String: Any])?["id"] as? String {
                pendingApprovals.removeAll { $0.id == id }
            }
        case "status":
            // Refresh status
            if let s = try? await api.status() {
                serverStatus = s
                isConnected = true
            }
        default:
            break
        }
    }

    private func poll() async {
        do {
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

            // Load cached audit results (non-blocking)
            if auditSummary == nil {
                if let audit = try? await api.auditResults(), audit.summary != nil {
                    auditSummary = audit.summary
                }
            }

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

    func alwaysApprove(approval: ApprovalItem) async {
        do {
            // Record to memory as always-approve
            let _: GenericResponse = try await api.markDecision(
                toolName: approval.toolName ?? "unknown",
                command: approval.displayInput,
                decision: "approve"
            )
            // Also approve this specific instance
            await approve(id: approval.id, backend: approval.backend)
        } catch {
            lastError = "Always Approve failed: \(error.localizedDescription)"
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

    // MARK: - Blocking Rules

    func refreshBlockingStatus() async {
        blockingStatus = try? await api.blockingStatus()
    }
}
