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

            // Per-backend connection dots
            if appState.isConnected, let backends = appState.serverStatus?.backends {
                HStack(spacing: 6) {
                    ForEach(Array(backends.keys.sorted()), id: \.self) { key in
                        let status = backends[key]
                        HStack(spacing: 3) {
                            Circle()
                                .fill(status?.connected == true ? Color.green : Color.gray)
                                .frame(width: 6, height: 6)
                            Text(status?.label ?? key.uppercased())
                                .font(.system(size: 9, weight: .medium))
                                .foregroundStyle(status?.connected == true ? .secondary : .tertiary)
                        }
                    }
                }
            } else {
                // Server unreachable
                Circle()
                    .fill(Color.red)
                    .frame(width: 8, height: 8)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
