import SwiftUI

struct ProviderCardView: View {
    @Bindable var appState: AppState
    let provider: any BackendProvider

    private var backendStatus: BackendStatus? {
        appState.backendStatus(for: provider.backendKey)
    }

    private var backendApprovals: [ApprovalItem] {
        appState.approvalsForBackend(provider.backendKey)
    }

    /// All events for this backend (server-side filtered)
    private var backendEvents: [EventItem] {
        appState.eventsForBackend(provider.backendKey)
    }

    /// Thresholds: safe ≤3, warning 4-7, blocked >7
    /// Use effectiveRiskScore (falls back to safeguard.riskScore)
    private var backendSafeCount: Int {
        backendEvents.filter { $0.effectiveRiskScore <= 3 }.count
    }

    private var backendWarnCount: Int {
        backendEvents.filter {
            $0.effectiveRiskScore > 3 && $0.effectiveRiskScore <= 7
        }.count
    }

    private var backendBlockCount: Int {
        backendEvents.filter { $0.effectiveRiskScore > 7 }.count
    }

    private var backendHighRiskEvents: [EventItem] {
        let filtered = backendEvents
            .filter {
                let v = $0.safeguard?.verdict?.lowercased()
                return v == "block" || v == "blocked" || $0.effectiveRiskScore >= 8
            }
        // Dedup: keep only the most recent event per tool+displayText
        var seen = Set<String>()
        var result: [EventItem] = []
        for event in filtered {
            let key = "\(event.tool ?? ""):\(event.displayText)"
            if seen.insert(key).inserted {
                result.append(event)
            }
            if result.count >= 10 { break }
        }
        return result
    }

    @State private var auditFindings: [AuditFinding] = []
    @State private var auditSummary: AuditSummary? = nil
    @State private var isAuditScanning = false
    @State private var hasAuditScanned = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            connectionSection
            securityScanSection
            statsSection
            if !backendApprovals.isEmpty {
                approvalsSection
            }
            highRiskSection
        }
        .task {
            await loadCachedAuditResults()
        }
    }

    // MARK: - Connection

    private var connectionSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            sectionHeader("CONNECTION")
            HStack(spacing: 6) {
                Circle()
                    .fill(backendStatus?.connected == true ? Color.green : Color.gray)
                    .frame(width: 8, height: 8)
                Text(backendStatus?.connected == true ? "Connected" : "Disconnected")
                    .font(.subheadline)
                if let type = backendStatus?.type {
                    Text("(\(type))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: - Stats

    private var statsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionHeader("STATS")

            Text("Events: \(backendEvents.count)")
                .font(.subheadline)

            // Risk distribution bar
            riskBar

            HStack(spacing: 12) {
                statLabel("Safe", count: backendSafeCount, color: .green)
                statLabel("Warn", count: backendWarnCount, color: .orange)
                statLabel("Block", count: backendBlockCount, color: .red)
            }
            .font(.caption)

            // Token usage summary
            if let usage = appState.serverStatus?.tokenUsage, (usage.totalTokens ?? 0) > 0 {
                Divider()
                let total = usage.totalTokens ?? 0
                let reqs = usage.requests ?? 0
                Text("Judge: \(formatTokenCount(total)) tokens · \(reqs) calls")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func formatTokenCount(_ count: Int) -> String {
        if count >= 1_000_000 { return String(format: "%.1fM", Double(count) / 1_000_000.0) }
        if count >= 1_000 { return String(format: "%.1fK", Double(count) / 1_000.0) }
        return "\(count)"
    }

    private var riskBar: some View {
        GeometryReader { geo in
            let total = max(backendSafeCount + backendWarnCount + backendBlockCount, 1)
            let safeW = CGFloat(backendSafeCount) / CGFloat(total) * geo.size.width
            let warnW = CGFloat(backendWarnCount) / CGFloat(total) * geo.size.width
            let blockW = CGFloat(backendBlockCount) / CGFloat(total) * geo.size.width

            HStack(spacing: 1) {
                if backendSafeCount > 0 {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.green)
                        .frame(width: safeW)
                }
                if backendWarnCount > 0 {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.orange)
                        .frame(width: warnW)
                }
                if backendBlockCount > 0 {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.red)
                        .frame(width: blockW)
                }
                if total <= 1 && backendSafeCount == 0 {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.gray.opacity(0.3))
                }
            }
        }
        .frame(height: 6)
        .clipShape(RoundedRectangle(cornerRadius: 3))
    }

    private func statLabel(_ label: String, count: Int, color: Color) -> some View {
        HStack(spacing: 3) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text("\(label): \(count)")
        }
    }

    // MARK: - Approvals

    private var approvalsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionHeader("PENDING APPROVALS (\(backendApprovals.count))")
            ApprovalListView(
                appState: appState,
                approvals: backendApprovals
            )
        }
    }

    // MARK: - High Risk Events

    private var highRiskSection: some View {
        let highRisk = backendHighRiskEvents
        return Group {
            if !highRisk.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    sectionHeader("RECENT FLAGGED / BLOCKED")
                    ForEach(highRisk, id: \.stableId) { event in
                        HighRiskRowView(event: event)
                    }
                }
            }
        }
    }

    // MARK: - Security Scan

    private var securityScanSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                sectionHeader("SECURITY SCAN")
                Spacer()
                if hasAuditScanned, let s = auditSummary {
                    let risky = (s.dangerousTools ?? 0) + (s.dangerousSkills ?? 0)
                    if risky == 0 {
                        HStack(spacing: 3) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.caption2)
                                .foregroundStyle(.green)
                            Text("Clean")
                                .font(.caption2)
                                .foregroundStyle(.green)
                        }
                    } else {
                        Text("\(risky) risky")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                }
                Button {
                    Task { await runAuditScan() }
                } label: {
                    if isAuditScanning {
                        ProgressView().controlSize(.mini)
                    } else {
                        Image(systemName: "play.fill")
                            .font(.system(size: 9))
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(.blue)
                .disabled(isAuditScanning)
            }

            if hasAuditScanned, let s = auditSummary {
                HStack(spacing: 10) {
                    auditStatLabel("Tools", total: s.totalTools ?? 0, risky: s.dangerousTools ?? 0)
                    auditStatLabel("Skills", total: s.totalSkills ?? 0, risky: s.dangerousSkills ?? 0)
                    let vulns = s.vulnerabilities ?? 0
                    HStack(spacing: 2) {
                        if vulns > 0 {
                            Image(systemName: "exclamationmark.shield.fill")
                                .font(.system(size: 8))
                                .foregroundStyle(.red)
                        }
                        Text("\(vulns) Vulns")
                            .foregroundStyle(vulns > 0 ? .red : .green)
                    }
                }
                .font(.caption2)

                // Show risky tool/skill names
                let riskyNames = (s.dangerousToolList ?? []) + (s.dangerousSkillList ?? [])
                if !riskyNames.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 8))
                            .foregroundStyle(.red)
                        Text(riskyNames.joined(separator: ", "))
                            .font(.system(size: 9))
                            .foregroundStyle(.red)
                    }
                }
            }

            if hasAuditScanned && !auditFindings.isEmpty {
                ForEach(auditFindings.prefix(3)) { f in
                    HStack(spacing: 6) {
                        Circle()
                            .fill(auditSeverityColor(f.severity))
                            .frame(width: 6, height: 6)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(f.title ?? "")
                                .font(.system(size: 9, weight: .medium))
                                .lineLimit(1)
                            HStack(spacing: 4) {
                                if let source = f.source {
                                    Text(source)
                                        .font(.system(size: 8, weight: .medium))
                                        .foregroundStyle(.blue)
                                }
                                if let name = f.sourceName ?? f.skillName {
                                    Text(name)
                                        .font(.system(size: 8))
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        Spacer()
                    }
                }
            }
        }
    }

    private func auditSeverityColor(_ s: String?) -> Color {
        switch s {
        case "critical": return .red
        case "high": return .orange
        case "medium": return .yellow
        default: return .gray
        }
    }

    private func auditStatLabel(_ label: String, total: Int, risky: Int) -> some View {
        HStack(spacing: 3) {
            Text("\(label): \(total)")
                .foregroundStyle(.secondary)
            if risky > 0 {
                Text("(\(risky) risky)")
                    .foregroundStyle(.orange)
            }
        }
    }

    private func loadCachedAuditResults() async {
        do {
            let resp = try await GuardClawAPI().auditResults()
            auditFindings = resp.findings.sorted {
                auditSeverityRank($0.severity) < auditSeverityRank($1.severity)
            }
            if let s = resp.summary { auditSummary = s }
            hasAuditScanned = resp.summary != nil
        } catch {}
    }

    private func runAuditScan() async {
        isAuditScanning = true
        defer { isAuditScanning = false }
        do {
            let resp = try await GuardClawAPI().auditScan()
            auditFindings = resp.findings.sorted {
                auditSeverityRank($0.severity) < auditSeverityRank($1.severity)
            }
            auditSummary = resp.summary
            hasAuditScanned = true
        } catch {
            hasAuditScanned = true
        }
    }

    private func auditSeverityRank(_ s: String?) -> Int {
        switch s {
        case "critical": return 0
        case "high": return 1
        case "medium": return 2
        default: return 3
        }
    }

    // MARK: - Helpers

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.caption)
            .fontWeight(.semibold)
            .foregroundStyle(.secondary)
    }
}

// MARK: - Expandable High Risk Row

private struct HighRiskRowView: View {
    let event: EventItem
    @State private var isExpanded = false

    private var isBlocked: Bool {
        let v = event.safeguard?.verdict?.lowercased()
        return v == "block" || v == "blocked" || event.effectiveRiskScore > 7
    }

    private var accentColor: Color {
        isBlocked ? .red : .orange
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Header row — always visible
            HStack(spacing: 6) {
                Image(systemName: isBlocked ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(accentColor)

                VStack(alignment: .leading, spacing: 1) {
                    // Tool / command name
                    if let tool = event.tool ?? event.command {
                        Text(tool)
                            .font(.caption)
                            .fontWeight(.medium)
                    }
                    // Description or text preview
                    Text(event.description ?? event.text ?? event.displayText)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(isExpanded ? nil : 2)
                }

                Spacer()

                Text(isBlocked ? "BLOCKED" : "FLAGGED")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(accentColor)

                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.system(size: 8))
                    .foregroundStyle(.tertiary)
            }

            // Expanded detail
            if isExpanded {
                VStack(alignment: .leading, spacing: 4) {
                    detailRow("Time", event.timeAgoText)
                    detailRow("Score", "\(Int(event.effectiveRiskScore))/10")
                    if let cat = event.safeguard?.category ?? event.category {
                        detailRow("Category", cat)
                    }
                    if let reasoning = event.safeguard?.reasoning, !reasoning.isEmpty {
                        Text("Reason:")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(.secondary)
                        Text(reasoning)
                            .font(.system(size: 10))
                            .foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let backend = event.safeguard?.backend {
                        detailRow("Judge", backend)
                    }
                }
                .padding(.top, 4)
                .padding(.leading, 20)
            }
        }
        .padding(8)
        .background(accentColor.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture { withAnimation(.easeInOut(duration: 0.15)) { isExpanded.toggle() } }
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack(spacing: 4) {
            Text(label + ":")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 10))
        }
    }
}
