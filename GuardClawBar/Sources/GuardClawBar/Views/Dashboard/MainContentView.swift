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
        .onAppear {
            // Handle navigation set before this view rendered
            if let page = appState.navigateTo {
                selectedPage = page
                appState.navigateTo = nil
            }
        }
        .onChange(of: appState.navigateTo) { _, target in
            if let page = target {
                selectedPage = page
                appState.navigateTo = nil
            }
        }
        .toolbar {
            ToolbarItem(placement: .navigation) {
                EmptyView()
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
        case .audit:
            AuditView()
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

}
