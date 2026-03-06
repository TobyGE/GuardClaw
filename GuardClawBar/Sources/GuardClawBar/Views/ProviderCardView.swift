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
        backendEvents
            .filter { $0.effectiveRiskScore > 3 }
            .prefix(5)
            .map { $0 }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            connectionSection
            statsSection
            if !backendApprovals.isEmpty {
                approvalsSection
            }
            highRiskSection
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
        }
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
                    sectionHeader("RECENT HIGH-RISK")
                    ForEach(highRisk, id: \.stableId) { event in
                        highRiskRow(event)
                    }
                }
            }
        }
    }

    private func highRiskRow(_ event: EventItem) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.red)

            Text(event.displayText)
                .font(.caption)
                .lineLimit(1)

            Spacer()

            Text("\(Int(event.effectiveRiskScore))/10")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.red)

            Text(event.timeAgoText)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(6)
        .background(Color.red.opacity(0.06), in: RoundedRectangle(cornerRadius: 4))
    }

    // MARK: - Helpers

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.caption)
            .fontWeight(.semibold)
            .foregroundStyle(.secondary)
    }
}
