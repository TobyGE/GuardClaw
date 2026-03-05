import SwiftUI

struct ProviderTabView: View {
    @Bindable var appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            // Tab bar
            HStack(spacing: 0) {
                ForEach(appState.providers, id: \.id) { provider in
                    tabButton(provider: provider)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)

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

        return Button(action: { appState.selectedTab = provider.id }) {
            HStack(spacing: 4) {
                Text(provider.displayName)
                    .font(.subheadline)
                    .fontWeight(isSelected ? .semibold : .regular)

                if pendingCount > 0 {
                    Text("\(pendingCount)")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Color.orange, in: Capsule())
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(isSelected ? Color.accentColor.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
    }
}
