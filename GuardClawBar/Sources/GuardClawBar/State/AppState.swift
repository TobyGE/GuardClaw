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
    var geminiEvents: [EventItem] = []
    var cursorEvents: [EventItem] = []

    // Approvals
    var pendingApprovals: [ApprovalItem] = []
    var pendingCount: Int { pendingApprovals.count }

    // Blocking/Rules
    var blockingStatus: BlockingStatusResponse?

    // Security Scan
    var auditSummary: AuditSummary?
    var securityScanResult: SecurityScanResponse?
    var isSecurityScanning = false

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
    let providers: [any BackendProvider] = [ClaudeCodeProvider(), OpenClawProvider(), GeminiCLIProvider(), CursorProvider()]

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
        case "gemini-cli": return geminiEvents
        case "cursor": return cursorEvents
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
        // Auto-run security scan in background on launch
        Task { [weak self] in
            // Wait for server to be reachable
            try? await Task.sleep(for: .seconds(3))
            await self?.runBackgroundSecurityScan()
        }
    }

    /// Run security scan in background, notify on completion
    func runBackgroundSecurityScan() async {
        guard !isSecurityScanning else { return }
        isSecurityScanning = true
        do {
            let result = try await api.securityScan()
            securityScanResult = result
            let count = result.findings?.count ?? 0
            notificationManager.notifyScanComplete(findings: count)
        } catch {
            // Server not ready yet — will scan on next poll cycle
        }
        isSecurityScanning = false
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
            var backoff: Double = 1
            while !Task.isCancelled {
                let connected = await self?.connectSSE() ?? false
                if connected { backoff = 1 } // Reset on successful connection
                do { try await Task.sleep(for: .seconds(backoff)) } catch { break }
                backoff = min(backoff * 2, 30)
            }
        }
    }

    @discardableResult
    private func connectSSE() async -> Bool {
        guard let url = URL(string: "\(SettingsStore.shared.serverURL)/api/events") else { return false }

        // Load full event history once on first SSE connect
        if !eventsInitialized {
            async let cc = try? api.eventHistory(limit: 999999, backend: "claude-code")
            async let oc = try? api.eventHistory(limit: 999999, backend: "openclaw")
            async let gm = try? api.eventHistory(limit: 999999, backend: "gemini-cli")
            async let cu = try? api.eventHistory(limit: 999999, backend: "cursor")
            if let ccResult = await cc { ccEvents = ccResult.events }
            if let ocResult = await oc { ocEvents = ocResult.events }
            if let gmResult = await gm { geminiEvents = gmResult.events }
            if let cuResult = await cu { cursorEvents = cuResult.events }
            if let ts = ccEvents.first?.timestamp { ccLastTimestamp = Int(ts) }
            if let ts = ocEvents.first?.timestamp { ocLastTimestamp = Int(ts) }
            if let ts = geminiEvents.first?.timestamp { geminiLastTimestamp = Int(ts) }
            if let ts = cursorEvents.first?.timestamp { cursorLastTimestamp = Int(ts) }
            eventsInitialized = true
        }

        var receivedEvents = false
        let client = SSEClient(url: url)
        for await event in await client.events() {
            guard !Task.isCancelled else { break }
            receivedEvents = true
            await handleSSEEvent(event)
        }
        return receivedEvents
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
                var isNew = false
                if backend == "openclaw" {
                    if !ocEvents.contains(where: { $0.id == eventData.id }) {
                        ocEvents.insert(eventData, at: 0)
                        isNew = true
                    }
                } else if backend == "gemini-cli" || eventData.sessionKey?.hasPrefix("gemini:") == true {
                    if !geminiEvents.contains(where: { $0.id == eventData.id }) {
                        geminiEvents.insert(eventData, at: 0)
                        isNew = true
                    }
                } else if backend == "cursor" || eventData.sessionKey?.hasPrefix("cursor:") == true {
                    if !cursorEvents.contains(where: { $0.id == eventData.id }) {
                        cursorEvents.insert(eventData, at: 0)
                        isNew = true
                    }
                } else {
                    if !ccEvents.contains(where: { $0.id == eventData.id }) {
                        ccEvents.insert(eventData, at: 0)
                        isNew = true
                    }
                }
                // Notify on high-risk events (score >= 8) for all backends
                if isNew {
                    notificationManager.notifyHighRiskEvent(eventData)
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

    private var eventPollCounter = 0
    private var ccLastTimestamp: Int?  // milliseconds epoch for server query
    private var ocLastTimestamp: Int?
    private var geminiLastTimestamp: Int?
    private var cursorLastTimestamp: Int?
    private var eventsInitialized = false

    private func poll() async {
        do {
            eventPollCounter += 1
            let previousPendingIds = Set(pendingApprovals.map(\.id))

            // Events: delta poll every 6th cycle (~30s), first poll fetches all
            let shouldFetchEvents = eventPollCounter % 6 == 1

            if shouldFetchEvents {
                async let statusResult = api.status()
                async let approvalsResult = api.pendingApprovals()

                if eventsInitialized {
                    // Delta: only fetch events newer than last known timestamp
                    async let ccResult = api.eventHistory(limit: 999999, backend: "claude-code", since: ccLastTimestamp)
                    async let ocResult = api.eventHistory(limit: 999999, backend: "openclaw", since: ocLastTimestamp)
                    async let gmResult = api.eventHistory(limit: 999999, backend: "gemini-cli", since: geminiLastTimestamp)
                    async let cuResult = api.eventHistory(limit: 999999, backend: "cursor", since: cursorLastTimestamp)

                    serverStatus = try await statusResult
                    pendingApprovals = (try await approvalsResult).pending

                    let newCC = (try await ccResult).events
                    let newOC = (try await ocResult).events
                    let newGM = (try await gmResult).events
                    let newCU = (try await cuResult).events
                    mergeNewEvents(&ccEvents, newEvents: newCC, lastTimestamp: &ccLastTimestamp)
                    mergeNewEvents(&ocEvents, newEvents: newOC, lastTimestamp: &ocLastTimestamp)
                    mergeNewEvents(&geminiEvents, newEvents: newGM, lastTimestamp: &geminiLastTimestamp)
                    mergeNewEvents(&cursorEvents, newEvents: newCU, lastTimestamp: &cursorLastTimestamp)
                } else {
                    // First poll: fetch all events
                    async let ccResult = api.eventHistory(limit: 999999, backend: "claude-code")
                    async let ocResult = api.eventHistory(limit: 999999, backend: "openclaw")
                    async let gmResult = api.eventHistory(limit: 999999, backend: "gemini-cli")
                    async let cuResult = api.eventHistory(limit: 999999, backend: "cursor")

                    serverStatus = try await statusResult
                    pendingApprovals = (try await approvalsResult).pending

                    ccEvents = (try await ccResult).events
                    ocEvents = (try await ocResult).events
                    geminiEvents = (try await gmResult).events
                    cursorEvents = (try await cuResult).events
                    if let ts = ccEvents.first?.timestamp { ccLastTimestamp = Int(ts) }
                    if let ts = ocEvents.first?.timestamp { ocLastTimestamp = Int(ts) }
                    if let ts = geminiEvents.first?.timestamp { geminiLastTimestamp = Int(ts) }
                    if let ts = cursorEvents.first?.timestamp { cursorLastTimestamp = Int(ts) }
                    eventsInitialized = true
                }
            } else {
                async let statusResult = api.status()
                async let approvalsResult = api.pendingApprovals()

                serverStatus = try await statusResult
                pendingApprovals = (try await approvalsResult).pending
            }

            isConnected = true
            lastError = nil

            // Load cached audit results (non-blocking)
            if auditSummary == nil {
                if let audit = try? await api.auditResults(), audit.summary != nil {
                    auditSummary = audit.summary
                }
            }

            let newApprovals = pendingApprovals.filter { !previousPendingIds.contains($0.id) }
            for approval in newApprovals {
                notificationManager.notifyNewApproval(approval)
            }
        } catch {
            isConnected = false
            lastError = error.localizedDescription
        }
    }

    /// Merge new events into existing array (newest first), update lastTimestamp, cap at 500
    private func mergeNewEvents(_ existing: inout [EventItem], newEvents: [EventItem], lastTimestamp: inout Int?) {
        guard !newEvents.isEmpty else { return }
        let existingIds = Set(existing.map(\.stableId))
        let unique = newEvents.filter { !existingIds.contains($0.stableId) }
        if !unique.isEmpty {
            existing.insert(contentsOf: unique, at: 0)
        }
        // Update timestamp to newest event
        if let newest = newEvents.first?.timestamp {
            let newestInt = Int(newest)
            if newestInt > (lastTimestamp ?? 0) {
                lastTimestamp = newestInt
            }
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
