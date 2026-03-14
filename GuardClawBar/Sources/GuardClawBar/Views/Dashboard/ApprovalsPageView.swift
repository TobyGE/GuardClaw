import SwiftUI

struct ApprovalsPageView: View {
    @Environment(AppState.self) var appState
    private var L: Loc { Loc.shared }

    var body: some View {
        Group {
            if appState.pendingApprovals.isEmpty {
                ContentUnavailableView(
                    L.t("approvals.noApprovals"),
                    systemImage: "checkmark.shield",
                    description: Text(L.t("approvals.noApprovalsDesc"))
                )
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(appState.pendingApprovals) { approval in
                            ApprovalCard(approval: approval)
                        }
                    }
                    .padding(16)
                }
            }
        }
        .navigationTitle(L.t("approvals.title"))
        .toolbar {
            if appState.pendingCount > 0 {
                ToolbarItem {
                    Text(L.t("approvals.pending", appState.pendingCount))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct ApprovalCard: View {
    @Environment(AppState.self) var appState
    let approval: ApprovalItem
    @State private var isActing = false
    private var L: Loc { Loc.shared }

    private var riskScore: Int { Int(approval.riskScore ?? 0) }
    private var riskColor: Color {
        if riskScore >= 8 { return .red }
        if riskScore >= 5 { return .orange }
        return .green
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header: tool + risk
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Image(systemName: "terminal")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text(approval.toolName ?? L.t("approvals.unknownTool"))
                            .font(.subheadline)
                            .fontWeight(.semibold)
                    }
                    if let input = approval.displayInput {
                        Text(input)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text("\(riskScore)/10")
                        .font(.title3)
                        .fontWeight(.bold)
                        .foregroundStyle(riskColor)
                    Text(L.t("approvals.riskScore"))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            // Reason
            if let reason = approval.reason {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(riskColor)
                    Text(reason)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(8)
                .background(riskColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            }

            // Action buttons
            HStack(spacing: 10) {
                Button {
                    isActing = true
                    Task {
                        await appState.deny(id: approval.id, backend: approval.backend)
                        isActing = false
                    }
                } label: {
                    Label(L.t("common.deny"), systemImage: "xmark")
                }
                .buttonStyle(.bordered)
                .tint(.red)
                .disabled(isActing)

                Spacer()

                Button {
                    isActing = true
                    Task {
                        await appState.alwaysApprove(approval: approval)
                        isActing = false
                    }
                } label: {
                    Label(L.t("approvals.alwaysApprove"), systemImage: "checkmark.seal")
                }
                .buttonStyle(.bordered)
                .tint(.blue)
                .disabled(isActing)

                Button {
                    isActing = true
                    Task {
                        await appState.approve(id: approval.id, backend: approval.backend)
                        isActing = false
                    }
                } label: {
                    Label(L.t("common.approve"), systemImage: "checkmark")
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(isActing)
            }

            // Elapsed time
            if let elapsed = approval.elapsed {
                Text(L.t("approvals.waiting", String(format: "%.1f", elapsed)))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(riskColor.opacity(0.3), lineWidth: 1.5)
        )
    }
}
