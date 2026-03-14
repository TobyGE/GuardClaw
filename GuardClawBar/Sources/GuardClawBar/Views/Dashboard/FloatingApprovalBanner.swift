import SwiftUI

/// Floating banner pinned at the bottom of the content area when there are pending approvals.
struct FloatingApprovalBanner: View {
    @Environment(AppState.self) var appState
    @Binding var selectedPage: SidebarItem
    private var L: Loc { Loc.shared }

    private var mostRecent: ApprovalItem? { appState.pendingApprovals.first }

    var body: some View {
        if let approval = mostRecent {
            VStack(spacing: 0) {
                Divider()
                HStack(spacing: 12) {
                    // Pulsing dot
                    Circle()
                        .fill(.red)
                        .frame(width: 8, height: 8)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(approval.toolName ?? L.t("approvals.unknownTool"))
                            .font(.caption)
                            .fontWeight(.semibold)
                        if let input = approval.displayInput {
                            Text(input)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }

                    Spacer()

                    if appState.pendingCount > 1 {
                        Text(L.t("banner.more", appState.pendingCount - 1))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    Button(L.t("common.review")) {
                        selectedPage = .approvals
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .controlSize(.small)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.red.opacity(0.08))
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}
