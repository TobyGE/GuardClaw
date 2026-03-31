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
    var copilotEvents: [EventItem] = []
    var cursorEvents: [EventItem] = []
    var opencodeEvents: [EventItem] = []
    var codexEvents: [EventItem] = []

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
    var navigateTo: SidebarItem? = nil
    var isPolling = false
    var lastError: String?

    // Providers
    let providers: [any BackendProvider] = [ClaudeCodeProvider(), CodexProvider(), GeminiCLIProvider(), OpenCodeProvider(), OpenClawProvider(), CopilotProvider(), CursorProvider()]

    // Cached high-risk events for instant display before full load
    var cachedFlaggedEvents: [EventItem] = []
    var cachedBackendFlagged: [String: [EventItem]] = [:]

    // Internals
    let api = GuardClawAPI()
    private var pollTask: Task<Void, Never>?
    private var sseTask: Task<Void, Never>?
    private let notificationManager = NotificationManager()

    init() {
        if let cached = StateCache.load() {
            self.serverStatus = cached.serverStatus
            self.cachedFlaggedEvents = cached.recentFlagged
            self.cachedBackendFlagged = cached.backendFlagged
            // Restore recent events per backend for instant Activity view
            for (key, events) in cached.recentEvents {
                switch key {
                case "claude-code": self.ccEvents = events
                case "openclaw": self.ocEvents = events
                case "gemini-cli": self.geminiEvents = events
                case "copilot": self.copilotEvents = events
                case "cursor": self.cursorEvents = events
                case "opencode": self.opencodeEvents = events
                case "codex": self.codexEvents = events
                default: break
                }
            }
        }
    }

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
        case "copilot": return copilotEvents
        case "cursor": return cursorEvents
        case "opencode": return opencodeEvents
        case "codex": return codexEvents
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
            var backoff: Double = 3
            while !Task.isCancelled {
                let connected = await self?.connectSSE() ?? false
                if connected { backoff = 3 } // Reset to minimum, not 1s
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
            async let cc = try? api.eventHistory(limit: 200, backend: "claude-code")
            async let oc = try? api.eventHistory(limit: 200, backend: "openclaw")
            async let gm = try? api.eventHistory(limit: 200, backend: "gemini-cli")
            async let cp = try? api.eventHistory(limit: 200, backend: "copilot")
            async let cu = try? api.eventHistory(limit: 200, backend: "cursor")
            async let op = try? api.eventHistory(limit: 200, backend: "opencode")
            async let cdx = try? api.eventHistory(limit: 200, backend: "codex")
            if let ccResult = await cc { ccEvents = ccResult.events }
            if let ocResult = await oc { ocEvents = ocResult.events }
            if let gmResult = await gm { geminiEvents = gmResult.events }
            if let cpResult = await cp { copilotEvents = cpResult.events }
            if let cuResult = await cu { cursorEvents = cuResult.events }
            if let opResult = await op { opencodeEvents = opResult.events }
            if let cdxResult = await cdx { codexEvents = cdxResult.events }
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
                let sk = eventData.sessionKey ?? ""
                let backend = sk.hasPrefix("agent:") ? "openclaw"
                    : sk.hasPrefix("gemini:") ? "gemini-cli"
                    : sk.hasPrefix("copilot:") ? "copilot"
                    : sk.hasPrefix("cursor:") ? "cursor"
                    : sk.hasPrefix("opencode:") ? "opencode"
                    : sk.hasPrefix("codex:") ? "codex"
                    : sk.hasPrefix("claude-code:") ? "claude-code"
                    : (eventData.safeguard?.backend ?? "claude-code")
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
                } else if backend == "copilot" || eventData.sessionKey?.hasPrefix("copilot:") == true {
                    if !copilotEvents.contains(where: { $0.id == eventData.id }) {
                        copilotEvents.insert(eventData, at: 0)
                        isNew = true
                    }
                } else if backend == "cursor" || eventData.sessionKey?.hasPrefix("cursor:") == true {
                    if !cursorEvents.contains(where: { $0.id == eventData.id }) {
                        cursorEvents.insert(eventData, at: 0)
                        isNew = true
                    }
                } else if backend == "opencode" || eventData.sessionKey?.hasPrefix("opencode:") == true {
                    if !opencodeEvents.contains(where: { $0.id == eventData.id }) {
                        opencodeEvents.insert(eventData, at: 0)
                        isNew = true
                    }
                } else if backend == "codex" || eventData.sessionKey?.hasPrefix("codex:") == true {
                    if !codexEvents.contains(where: { $0.id == eventData.id }) {
                        codexEvents.insert(eventData, at: 0)
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

    private var eventsInitialized = false

    private func poll() async {
        do {
            let previousPendingIds = Set(pendingApprovals.map(\.id))

            // Events are loaded once on SSE connect and kept up-to-date via SSE stream.
            // Poll only fetches status + approvals (lightweight).
            async let statusResult = api.status()
            async let approvalsResult = api.pendingApprovals()

            serverStatus = try await statusResult
            pendingApprovals = (try await approvalsResult).pending

            isConnected = true
            lastError = nil

            // Cache state to disk for instant launch (only after events are loaded)
            if eventsInitialized {
                let allEvts = ccEvents + ocEvents + geminiEvents + copilotEvents + cursorEvents + opencodeEvents + codexEvents
                let flagged = allEvts.filter { $0.effectiveRiskScore >= 8 }
                    .sorted { ($0.timestamp ?? 0) > ($1.timestamp ?? 0) }
                let perBackend: [String: [EventItem]] = [
                    "claude-code": ccEvents.filter { $0.effectiveRiskScore >= 8 },
                    "openclaw": ocEvents.filter { $0.effectiveRiskScore >= 8 },
                    "gemini-cli": geminiEvents.filter { $0.effectiveRiskScore >= 8 },
                    "copilot": copilotEvents.filter { $0.effectiveRiskScore >= 8 },
                    "cursor": cursorEvents.filter { $0.effectiveRiskScore >= 8 },
                    "opencode": opencodeEvents.filter { $0.effectiveRiskScore >= 8 },
                    "codex": codexEvents.filter { $0.effectiveRiskScore >= 8 },
                ]
                let recentEvents: [String: [EventItem]] = [
                    "claude-code": Array(ccEvents.prefix(200)),
                    "openclaw": Array(ocEvents.prefix(200)),
                    "gemini-cli": Array(geminiEvents.prefix(200)),
                    "copilot": Array(copilotEvents.prefix(200)),
                    "cursor": Array(cursorEvents.prefix(200)),
                    "opencode": Array(opencodeEvents.prefix(200)),
                    "codex": Array(codexEvents.prefix(200)),
                ]
                StateCache.save(status: serverStatus, flaggedEvents: flagged, backendFlagged: perBackend, recentEvents: recentEvents)
            }

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
