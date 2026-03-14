import SwiftUI

struct DashboardView: View {
    @Environment(AppState.self) var appState
    private var L: Loc { Loc.shared }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Stats Grid
                statsGrid

                // Security Scan
                securityScanCard

                // Backend Connection Status
                if let backends = appState.serverStatus?.backends {
                    backendStatusCard(backends: backends)
                }

                // Token Usage
                if let tokens = appState.serverStatus?.agentTokens {
                    tokenUsageCard(tokens: tokens)
                }

                // Recent High-Risk Summary
                let highRisk = recentHighRiskEvents
                if !highRisk.isEmpty {
                    highRiskCard(events: highRisk)
                }
            }
            .padding(24)
        }
        .navigationTitle(L.t("dashboard.title"))
    }

    // MARK: - Stats Grid

    private var statsGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
            StatCard(title: L.t("dashboard.daysProtected"), value: "\(appState.daysProtected)", icon: "calendar.badge.checkmark", color: .blue)
            StatCard(title: L.t("dashboard.totalEvents"), value: "\(appState.totalEventCount)", icon: "bolt", color: .purple)
            StatCard(title: L.t("dashboard.pending"), value: "\(appState.pendingCount)", icon: "bell.badge", color: appState.pendingCount > 0 ? .red : .green)
            StatCard(title: L.t("dashboard.safeEvents"), value: "\(safeCount)", icon: "checkmark.shield", color: .green)
            StatCard(title: L.t("dashboard.warnings"), value: "\(warningCount)", icon: "exclamationmark.triangle", color: .orange)
            StatCard(title: L.t("dashboard.blocked"), value: "\(blockedCount)", icon: "xmark.shield", color: .red)
        }
    }

    // MARK: - Security Scan

    @ViewBuilder
    private var securityScanCard: some View {
        if let s = appState.auditSummary {
            let totalRisky = (s.dangerousTools ?? 0) + (s.dangerousSkills ?? 0)
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(L.t("dashboard.securityScan"))
                        .font(.headline)
                    Spacer()
                    if totalRisky == 0 {
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark.shield.fill")
                                .foregroundStyle(.green)
                            Text(L.t("common.clean"))
                                .font(.caption)
                                .foregroundStyle(.green)
                        }
                    } else {
                        Text(L.t("dashboard.risky", totalRisky))
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundStyle(.red)
                    }
                }

                let vulns = s.vulnerabilities ?? 0
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 5), spacing: 12) {
                    ScanStatCell(label: L.t("audit.tools"), value: "\(s.totalTools ?? 0)", color: .blue)
                    ScanStatCell(label: L.t("audit.skills"), value: "\(s.totalSkills ?? 0)", color: .blue)
                    ScanStatCell(label: L.t("audit.riskyTools"), value: "\(s.dangerousTools ?? 0)", color: (s.dangerousTools ?? 0) > 0 ? .red : .green)
                    ScanStatCell(label: L.t("audit.riskySkills"), value: "\(s.dangerousSkills ?? 0)", color: (s.dangerousSkills ?? 0) > 0 ? .red : .green)
                    ScanStatCell(label: L.t("audit.vulnerabilities"), value: "\(vulns)", color: vulns > 0 ? .red : .green)
                }

                // Show risky tool/skill names
                let riskyNames = (s.dangerousToolList ?? []) + (s.dangerousSkillList ?? [])
                if !riskyNames.isEmpty {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 9))
                            .foregroundStyle(.red)
                        Text(riskyNames.joined(separator: ", "))
                            .font(.caption2)
                            .foregroundStyle(.red)
                        Spacer()
                    }
                }
            }
            .padding(16)
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    // MARK: - Backend Status

    private func backendStatusCard(backends: [String: BackendStatus]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L.t("dashboard.connections"))
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
                        Text(b.connected == true ? L.t("common.connected") : L.t("common.disconnected"))
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
                    Text(L.t("dashboard.judgeLabel", llm.backend ?? "unknown"))
                        .font(.subheadline)
                    Spacer()
                    Text(llm.connected == true ? L.t("dashboard.ready") : L.t("common.notConnected"))
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
            Text(L.t("dashboard.recentHighRisk"))
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

    // MARK: - Token Usage

    private func tokenUsageCard(tokens: AgentTokensMap) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L.t("dashboard.tokenUsage"))
                .font(.headline)

            let pairs: [(String, AgentTokenPair?)] = [
                ("OpenClaw", tokens.openclaw),
                ("Claude Code", tokens.claudeCode),
            ]

            ForEach(pairs, id: \.0) { label, pair in
                if let pair, (pair.cumulative?.totalTokens ?? 0) > 0 || (pair.cumulative?.requests ?? 0) > 0 {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(label)
                            .font(.subheadline)
                            .fontWeight(.medium)

                        HStack(spacing: 20) {
                            tokenColumn(L.t("dashboard.today"), record: pair.today)
                            tokenColumn(L.t("dashboard.cumulative"), record: pair.cumulative)
                        }
                    }
                }
            }

            if (tokens.openclaw?.cumulative?.totalTokens ?? 0) == 0 &&
               (tokens.claudeCode?.cumulative?.totalTokens ?? 0) == 0 {
                Text(L.t("dashboard.noTokenData"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    private func tokenColumn(_ title: String, record: AgentTokenRecord?) -> some View {
        let input = record?.input_tokens ?? 0
        let output = record?.output_tokens ?? 0
        let cache = (record?.cache_read ?? 0) + (record?.cache_write ?? 0)
        let reqs = record?.requests ?? 0
        return VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(L.t("dashboard.tokens", formatTokenCount(input + output)))
                .font(.caption)
                .fontWeight(.medium)
            HStack(spacing: 8) {
                Text(L.t("dashboard.inTokens", formatTokenCount(input)))
                Text(L.t("dashboard.outTokens", formatTokenCount(output)))
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
            if cache > 0 {
                Text(L.t("dashboard.cacheTokens", formatTokenCount(cache)))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text(L.t("dashboard.requests", reqs))
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    private func formatTokenCount(_ count: Int) -> String {
        if count >= 1_000_000 { return String(format: "%.1fM", Double(count) / 1_000_000.0) }
        if count >= 1_000 { return String(format: "%.1fK", Double(count) / 1_000.0) }
        return "\(count)"
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
        let filtered = allEvents
            .filter { $0.effectiveRiskScore >= 8 }
            .sorted { ($0.timestamp ?? 0) > ($1.timestamp ?? 0) }
        // Dedup: keep only the most recent per tool+displayText
        var seen = Set<String>()
        return filtered.filter { event in
            let key = "\(event.tool ?? ""):\(event.displayText)"
            return seen.insert(key).inserted
        }
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

struct ScanStatCell: View {
    let label: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title3)
                .fontWeight(.bold)
                .foregroundStyle(color)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
