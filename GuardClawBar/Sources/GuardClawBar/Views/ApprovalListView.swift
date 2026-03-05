import SwiftUI

struct ApprovalListView: View {
    @Bindable var appState: AppState
    let approvals: [ApprovalItem]

    var body: some View {
        VStack(spacing: 6) {
            ForEach(approvals) { approval in
                ApprovalItemView(appState: appState, approval: approval)
            }
        }
    }
}
