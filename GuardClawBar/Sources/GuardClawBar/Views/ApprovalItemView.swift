import SwiftUI

struct ApprovalItemView: View {
    @Bindable var appState: AppState
    let approval: ApprovalItem
    @State private var isActing = false
    private var L: Loc { Loc.shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Tool name + input
            HStack(alignment: .top, spacing: 4) {
                Image(systemName: "terminal")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(approval.toolName ?? L.t("approvals.unknownTool"))
                        .font(.subheadline)
                        .fontWeight(.medium)
                    if let input = approval.displayInput {
                        Text(input)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
            }

            // Risk + reason
            HStack {
                riskBadge
                if let reason = approval.reason {
                    Text(reason)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            // Action buttons
            HStack(spacing: 8) {
                Spacer()
                Button(action: { performAction(approve: true) }) {
                    Label(L.t("common.approve"), systemImage: "checkmark")
                        .font(.caption)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .controlSize(.small)
                .disabled(isActing)

                Button(action: { performAction(approve: false) }) {
                    Label(L.t("common.deny"), systemImage: "xmark")
                        .font(.caption)
                }
                .buttonStyle(.bordered)
                .tint(.red)
                .controlSize(.small)
                .disabled(isActing)
            }
        }
        .padding(8)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(riskColor.opacity(0.3), lineWidth: 1)
        )
    }

    private var riskScore: Int { Int(approval.riskScore ?? 0) }

    private var riskColor: Color {
        if riskScore >= 9 { return .red }
        if riskScore >= 6 { return .orange }
        return .green
    }

    private var riskBadge: some View {
        Text(L.t("approvals.risk", riskScore))
            .font(.caption)
            .fontWeight(.semibold)
            .foregroundStyle(riskColor)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(riskColor.opacity(0.12), in: Capsule())
    }

    private func performAction(approve: Bool) {
        isActing = true
        Task {
            if approve {
                await appState.approve(id: approval.id, backend: approval.backend)
            } else {
                await appState.deny(id: approval.id, backend: approval.backend)
            }
            isActing = false
        }
    }
}
