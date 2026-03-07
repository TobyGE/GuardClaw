import SwiftUI

enum SidebarItem: String, CaseIterable, Hashable {
    case dashboard = "Dashboard"
    case activity = "Activity"
    case approvals = "Approvals"
    case rules = "Rules"
    case memory = "Memory"
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
        case .benchmark: return "TOOLS"
        case .judge, .connections, .protection: return "SETTINGS"
        }
    }
}

struct SidebarView: View {
    @Binding var selection: SidebarItem
    @Environment(AppState.self) var appState

    private let sections: [(String, [SidebarItem])] = [
        ("MONITOR", [.dashboard, .activity]),
        ("SECURITY", [.approvals, .rules, .memory]),
        ("TOOLS", [.benchmark]),
        ("SETTINGS", [.judge, .connections, .protection]),
    ]

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
                Text("GuardClaw")
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
                                Text(item.rawValue)
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
        }
        .listStyle(.sidebar)
        .frame(minWidth: 180, idealWidth: 200, maxWidth: 220)
    }
}
