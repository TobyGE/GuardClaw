import SwiftUI

struct MenuPopoverView: View {
    @Bindable var appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            headerView
            Divider()
            ProviderTabView(appState: appState)
            Divider()
            FooterView(appState: appState)
        }
        .frame(width: 360, height: 520)
    }

    // MARK: - Header

    private var headerView: some View {
        HStack(spacing: 8) {
            // Mini shield icon
            Image(nsImage: IconRenderer.render(status: .normal, badgeCount: 0))
                .resizable()
                .frame(width: 20, height: 20)

            Text("GuardClaw")
                .font(.headline)
                .fontWeight(.bold)

            if appState.daysProtected > 0 {
                Text("\(appState.daysProtected)d protected")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.quaternary)
                    .clipShape(Capsule())
            }

            Spacer()

            Circle()
                .fill(appState.connectionDotColor)
                .frame(width: 8, height: 8)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
