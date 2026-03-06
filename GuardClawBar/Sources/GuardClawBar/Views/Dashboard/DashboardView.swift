import SwiftUI

struct DashboardView: View {
    @Environment(AppState.self) var appState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Stats Grid
                statsGrid

                // Risk Distribution
                if let status = appState.serverStatus, let approvals = status.approvals {
                    riskDistributionCard(approvals: approvals)
                }

                // Backend Connection Status
                if let backends = appState.serverStatus?.backends {
                    backendStatusCard(backends: backends)
                }

                // Recent High-Risk Summary
                let highRisk = recentHighRiskEvents
                if !highRisk.isEmpty {
                    highRiskCard(events: highRisk)
                }
            }
            .padding(24)
        }
        .navigationTitle("Dashboard")
    }

    // MARK: - Stats Grid

    private var statsGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
            StatCard(title: "Days Protected", value: "\(appState.daysProtected)", icon: "calendar.badge.checkmark", color: .blue)
            StatCard(title: "Total Events", value: "\(appState.totalEventCount)", icon: "bolt", color: .purple)
            StatCard(title: "Pending", value: "\(appState.pendingCount)", icon: "bell.badge", color: appState.pendingCount > 0 ? .red : .green)
            StatCard(title: "Safe Events", value: "\(safeCount)", icon: "checkmark.shield", color: .green)
            StatCard(title: "Warnings", value: "\(warningCount)", icon: "exclamationmark.triangle", color: .orange)
            StatCard(title: "Blocked", value: "\(blockedCount)", icon: "xmark.shield", color: .red)
        }
    }

    // MARK: - Risk Distribution

    private func riskDistributionCard(approvals: ApprovalStats) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Risk Distribution")
                .font(.headline)

            let total = Double((approvals.autoAllowed ?? 0) + (approvals.userApproved ?? 0) + (approvals.autoBlocked ?? 0) + (approvals.userDenied ?? 0))
            if total > 0 {
                GeometryReader { geo in
                    HStack(spacing: 2) {
                        let safeW = geo.size.width * (Double((approvals.autoAllowed ?? 0) + (approvals.whitelisted ?? 0)) / total)
                        let warnW = geo.size.width * (Double(approvals.userApproved ?? 0) / total)
                        let blockW = geo.size.width * (Double((approvals.autoBlocked ?? 0) + (approvals.userDenied ?? 0) + (approvals.blacklisted ?? 0)) / total)

                        RoundedRectangle(cornerRadius: 4).fill(.green).frame(width: max(safeW, 0))
                        RoundedRectangle(cornerRadius: 4).fill(.orange).frame(width: max(warnW, 0))
                        RoundedRectangle(cornerRadius: 4).fill(.red).frame(width: max(blockW, 0))
                    }
                }
                .frame(height: 16)

                HStack(spacing: 16) {
                    LegendDot(color: .green, label: "Auto-allowed: \(approvals.autoAllowed ?? 0)")
                    LegendDot(color: .orange, label: "User-approved: \(approvals.userApproved ?? 0)")
                    LegendDot(color: .red, label: "Blocked: \((approvals.autoBlocked ?? 0) + (approvals.userDenied ?? 0))")
                }
            } else {
                Text("No events recorded yet")
                    .foregroundStyle(.secondary)
                    .font(.caption)
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Backend Status

    private func backendStatusCard(backends: [String: BackendStatus]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Connections")
                .font(.headline)

            ForEach(Array(backends.keys.sorted()), id: \.self) { key in
                if let b = backends[key] {
                    HStack {
                        Circle()
                            .fill(b.connected == true ? Color.green : Color.gray)
                            .frame(width: 8, height: 8)
                        Text(b.label ?? key)
                            .font(.subheadline)
                        Spacer()
                        Text(b.connected == true ? "Connected" : "Disconnected")
                            .font(.caption)
                            .foregroundStyle(b.connected == true ? .green : .secondary)
                    }
                }
            }

            // LLM Status
            if let llm = appState.serverStatus?.llmStatus {
                HStack {
                    Circle()
                        .fill(llm.connected == true ? Color.green : Color.orange)
                        .frame(width: 8, height: 8)
                    Text("Judge (\(llm.backend ?? "unknown"))")
                        .font(.subheadline)
                    Spacer()
                    Text(llm.connected == true ? "Ready" : "Not connected")
                        .font(.caption)
                        .foregroundStyle(llm.connected == true ? .green : .orange)
                }
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - High Risk

    private func highRiskCard(events: [EventItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent High-Risk Events")
                .font(.headline)

            ForEach(events.prefix(5), id: \.stableId) { event in
                HStack(spacing: 8) {
                    riskScoreBadge(score: event.effectiveRiskScore)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(event.displayText)
                            .font(.caption)
                            .fontWeight(.medium)
                            .lineLimit(1)
                        if let reason = event.safeguard?.reasoning {
                            Text(reason)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    Spacer()
                    Text(event.timeAgoText)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Helpers

    private var allEvents: [EventItem] { appState.ccEvents + appState.ocEvents }

    private var safeCount: Int {
        allEvents.filter { $0.effectiveRiskScore < 4 }.count
    }
    private var warningCount: Int {
        allEvents.filter { $0.effectiveRiskScore >= 4 && $0.effectiveRiskScore < 8 }.count
    }
    private var blockedCount: Int {
        allEvents.filter { $0.allowed == 0 }.count
    }
    private var recentHighRiskEvents: [EventItem] {
        allEvents.filter { $0.effectiveRiskScore >= 8 }.sorted { ($0.timestamp ?? 0) > ($1.timestamp ?? 0) }
    }

    private func riskScoreBadge(score: Double) -> some View {
        let color: Color = score >= 8 ? .red : score >= 5 ? .orange : .green
        return Text("\(Int(score))")
            .font(.caption2)
            .fontWeight(.bold)
            .foregroundStyle(color)
            .frame(width: 22, height: 22)
            .background(color.opacity(0.15), in: Circle())
    }
}

// MARK: - Supporting Views

struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .font(.caption)
                    .foregroundStyle(color)
                Spacer()
            }
            Text(value)
                .font(.title2)
                .fontWeight(.bold)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(color.opacity(0.2), lineWidth: 1)
        )
    }
}

struct LegendDot: View {
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}
