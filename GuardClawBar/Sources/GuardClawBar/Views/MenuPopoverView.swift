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

            Spacer()

            HStack(spacing: 4) {
                Circle()
                    .fill(appState.isConnected ? Color.green : Color.red)
                    .frame(width: 8, height: 8)
                Text(appState.isConnected ? "Connected" : "Disconnected")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
