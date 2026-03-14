import SwiftUI

struct ProviderTabView: View {
    @Bindable var appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            // Horizontally scrollable tab bar
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(appState.providers, id: \.id) { provider in
                        tabButton(provider: provider)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
            }

            Divider()

            // Tab content
            ScrollView {
                if let provider = appState.providers.first(where: { $0.id == appState.selectedTab }) {
                    ProviderCardView(appState: appState, provider: provider)
                        .padding(16)
                }
            }
        }
    }

    private func tabButton(provider: any BackendProvider) -> some View {
        let isSelected = appState.selectedTab == provider.id
        let pendingCount = appState.approvalsForBackend(provider.backendKey).count
        let isConnected = appState.backendStatus(for: provider.backendKey)?.connected == true

        return Button(action: { appState.selectedTab = provider.id }) {
            VStack(spacing: 3) {
                ZStack(alignment: .topTrailing) {
                    BrandIcon(provider.id, size: 18)
                        .opacity(isSelected ? 1 : 0.5)

                    // Connection dot
                    Circle()
                        .fill(isConnected ? Color.green : Color.gray.opacity(0.4))
                        .frame(width: 5, height: 5)
                        .offset(x: 2, y: -2)

                    // Pending badge
                    if pendingCount > 0 {
                        Text("\(pendingCount)")
                            .font(.system(size: 7, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 3)
                            .padding(.vertical, 1)
                            .background(Color.orange, in: Capsule())
                            .offset(x: 4, y: -4)
                    }
                }

                Text(provider.displayName)
                    .font(.system(size: 9))
                    .fontWeight(isSelected ? .semibold : .regular)
                    .lineLimit(1)
                    .fixedSize()
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(isSelected ? Color.accentColor.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}
