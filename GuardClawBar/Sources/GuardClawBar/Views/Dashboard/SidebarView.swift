import SwiftUI

enum SidebarItem: String, CaseIterable, Hashable {
    case dashboard = "Dashboard"
    case activity = "Activity"
    case approvals = "Approvals"
    case rules = "Rules"
    case memory = "Memory"
    case audit = "Security Scan"
    case benchmark = "Benchmark"
    case judge = "Judge"
    case connections = "Connections"
    case protection = "Protection"

    var icon: String {
        switch self {
        case .dashboard: return "shield.checkered"
        case .activity: return "list.bullet.rectangle"
        case .approvals: return "bell.badge"
        case .rules: return "list.bullet.indent"
        case .memory: return "brain"
        case .audit: return "magnifyingglass.circle"
        case .benchmark: return "chart.bar"
        case .judge: return "cpu"
        case .connections: return "link"
        case .protection: return "lock.shield"
        }
    }

    var section: String {
        switch self {
        case .dashboard, .activity: return "MONITOR"
        case .approvals, .rules, .memory: return "SECURITY"
        case .audit: return "TOOLS"
        case .benchmark: return "TOOLS"
        case .judge, .connections, .protection: return "SETTINGS"
        }
    }

    var localizedName: String {
        switch self {
        case .dashboard: return Loc.shared.t("sidebar.dashboard")
        case .activity: return Loc.shared.t("sidebar.activity")
        case .approvals: return Loc.shared.t("sidebar.approvals")
        case .rules: return Loc.shared.t("sidebar.rules")
        case .memory: return Loc.shared.t("sidebar.memory")
        case .audit: return Loc.shared.t("sidebar.securityScan")
        case .benchmark: return Loc.shared.t("sidebar.benchmark")
        case .judge: return Loc.shared.t("sidebar.judge")
        case .connections: return Loc.shared.t("sidebar.connections")
        case .protection: return Loc.shared.t("sidebar.protection")
        }
    }
}

struct SidebarView: View {
    @Binding var selection: SidebarItem
    @Environment(AppState.self) var appState
    private var L: Loc { Loc.shared }

    private var sections: [(String, [SidebarItem])] {
        [
            (L.t("sidebar.monitor"), [.dashboard, .activity]),
            (L.t("sidebar.security"), [.approvals, .rules, .memory]),
            (L.t("sidebar.tools"), [.audit, .benchmark]),
            (L.t("sidebar.settings"), [.judge, .connections, .protection]),
        ]
    }

    var body: some View {
        List(selection: $selection) {
            // Logo header
            HStack(spacing: 6) {
                Image(nsImage: {
                    let img = IconRenderer.render(status: appState.iconStatus, badgeCount: 0)
                    img.size = NSSize(width: 18, height: 18)
                    return img
                }())
                .renderingMode(.original)
                Text(L.t("header.title"))
                    .font(.headline)
                    .fontWeight(.bold)
            }
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))

            ForEach(sections, id: \.0) { section, items in
                Section(section) {
                    ForEach(items, id: \.self) { item in
                        Label {
                            HStack {
                                Text(item.localizedName)
                                if item == .approvals, appState.pendingCount > 0 {
                                    Spacer()
                                    Text("\(appState.pendingCount)")
                                        .font(.caption2)
                                        .fontWeight(.bold)
                                        .foregroundStyle(.white)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(.red, in: Capsule())
                                }
                            }
                        } icon: {
                            Image(systemName: item.icon)
                        }
                        .tag(item)
                    }
                }
            }

            Divider()
                .listRowSeparator(.hidden)
            Button { Loc.shared.toggle() } label: {
                HStack(spacing: 6) {
                    Image(systemName: "globe")
                        .font(.caption)
                    Text(Loc.shared.lang == "en" ? "中文" : "English")
                        .font(.caption)
                }
                .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .listRowSeparator(.hidden)
        }
        .listStyle(.sidebar)
        .frame(minWidth: 180, idealWidth: 200, maxWidth: 220)
    }
}
