import SwiftUI

struct MainContentView: View {
    @Environment(AppState.self) var appState
    @State private var selectedPage: SidebarItem = .dashboard
    @State private var showOnboarding: Bool
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    init(showOnboarding: Bool = false) {
        _showOnboarding = State(initialValue: showOnboarding)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            NavigationSplitView(columnVisibility: $columnVisibility) {
                SidebarView(selection: $selectedPage)
            } detail: {
                NavigationStack {
                    contentView(for: selectedPage)
                }
            }

            // Floating approval banner (visible on all pages)
            FloatingApprovalBanner(selectedPage: $selectedPage)
        }
        .sheet(isPresented: $showOnboarding) {
            OnboardingView(isPresented: $showOnboarding)
        }
        .toolbar {
            ToolbarItem(placement: .navigation) {
                HStack(spacing: 6) {
                    Image(nsImage: IconRenderer.render(status: appState.iconStatus, badgeCount: 0))
                        .resizable()
                        .frame(width: 18, height: 18)
                    Text("GuardClaw")
                        .font(.headline)
                        .fontWeight(.bold)
                }
            }
            ToolbarItemGroup(placement: .primaryAction) {
                HStack(spacing: 4) {
                    Circle()
                        .fill(appState.connectionDotColor)
                        .frame(width: 8, height: 8)
                    Text(connectionLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("")
    }

    // MARK: - Content Router

    @ViewBuilder
    private func contentView(for page: SidebarItem) -> some View {
        switch page {
        case .dashboard:
            DashboardView()
        case .activity:
            ActivityView()
        case .approvals:
            ApprovalsPageView()
        case .rules:
            RulesView()
        case .memory:
            MemoryView()
        case .benchmark:
            BenchmarkView()
        case .judge:
            JudgeSettingsView()
        case .connections:
            ConnectionsView()
        case .protection:
            ProtectionView()
        }
    }

    private var connectionLabel: String {
        guard appState.isConnected else { return "Disconnected" }
        let anyAgent = appState.serverStatus?.backends?.values.contains { $0.connected == true } ?? false
        return anyAgent ? "Agent connected" : "Server running"
    }
}
