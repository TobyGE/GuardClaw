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

    private var backendEvents: [EventItem] {
        appState.eventsForBackend(provider.backendKey)
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
                    .fill(backendStatus?.connected == true ? Color.green : Color.red)
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
            sectionHeader("STATS (total: \(appState.todayEventCount))")

            Text("Recent tool events: \(appState.safeCount + appState.warnCount + appState.blockCount)")
                .font(.subheadline)

            // Risk distribution bar
            riskBar

            HStack(spacing: 12) {
                statLabel("Safe", count: appState.safeCount, color: .green)
                statLabel("Warn", count: appState.warnCount, color: .orange)
                statLabel("Block", count: appState.blockCount, color: .red)
            }
            .font(.caption)
        }
    }

    private var riskBar: some View {
        GeometryReader { geo in
            let total = max(appState.safeCount + appState.warnCount + appState.blockCount, 1)
            let safeW = CGFloat(appState.safeCount) / CGFloat(total) * geo.size.width
            let warnW = CGFloat(appState.warnCount) / CGFloat(total) * geo.size.width
            let blockW = CGFloat(appState.blockCount) / CGFloat(total) * geo.size.width

            HStack(spacing: 1) {
                if appState.safeCount > 0 {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.green)
                        .frame(width: safeW)
                }
                if appState.warnCount > 0 {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.orange)
                        .frame(width: warnW)
                }
                if appState.blockCount > 0 {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.red)
                        .frame(width: blockW)
                }
                if total <= 1 && appState.safeCount == 0 {
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
        let highRisk = appState.highRiskEvents
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
