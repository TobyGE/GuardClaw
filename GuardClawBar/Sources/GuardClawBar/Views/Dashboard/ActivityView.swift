import SwiftUI

struct ActivityView: View {
    @Environment(AppState.self) var appState
    @State private var selectedBackend: String = "claude-code"

    private let backends = [
        ("claude-code", "Claude Code"),
        ("openclaw", "OpenClaw"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            // Backend picker
            Picker("Backend", selection: $selectedBackend) {
                ForEach(backends, id: \.0) { key, label in
                    Text(label).tag(key)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            Divider()

            let events = appState.eventsForBackend(selectedBackend)
            if events.isEmpty {
                ContentUnavailableView(
                    "No Activity Yet",
                    systemImage: "list.bullet.rectangle",
                    description: Text("Events will appear here as tool calls are intercepted")
                )
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8, pinnedViews: []) {
                        ForEach(groupedEvents(events), id: \.id) { group in
                            EventGroupView(group: group)
                        }
                    }
                    .padding(12)
                }
            }
        }
        .navigationTitle("Activity")
    }

    private func groupedEvents(_ events: [EventItem]) -> [EventGroup] {
        var groups: [EventGroup] = []
        var currentGroup: EventGroup? = nil

        for event in events.sorted(by: { ($0.timestamp ?? 0) > ($1.timestamp ?? 0) }) {
            let sessionKey = event.sessionKey ?? "default"
            if var group = currentGroup, group.sessionKey == sessionKey {
                group.events.append(event)
                currentGroup = group
                if groups.last?.id == group.id {
                    groups[groups.count - 1] = group
                }
            } else {
                if let g = currentGroup { groups.append(g) }
                currentGroup = EventGroup(sessionKey: sessionKey, events: [event])
            }
        }
        if let g = currentGroup { groups.append(g) }
        return groups
    }
}

struct EventGroup: Identifiable {
    var id: String { sessionKey + (events.first?.stableId ?? "") }
    let sessionKey: String
    var events: [EventItem]
}

struct EventGroupView: View {
    let group: EventGroup
    @State private var isExpanded = true

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Session header
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text("Session: \(shortSessionKey)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("\(group.events.count) events")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                ForEach(group.events, id: \.stableId) { event in
                    ToolCallRow(event: event)
                }
            }
        }
        .padding(10)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 10))
    }

    private var shortSessionKey: String {
        let key = group.sessionKey
        if key.count > 16 { return String(key.prefix(8)) + "..." + String(key.suffix(4)) }
        return key
    }
}

struct ToolCallRow: View {
    let event: EventItem
    @State private var expanded = false

    private var riskScore: Double { event.effectiveRiskScore }

    private var riskColor: Color {
        if riskScore >= 8 { return .red }
        if riskScore >= 4 { return .orange }
        return .green
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) { expanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    // Risk score pill
                    Text("\(Int(riskScore))")
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundStyle(riskColor)
                        .frame(width: 20, height: 20)
                        .background(riskColor.opacity(0.15), in: Circle())

                    // Tool name + input
                    VStack(alignment: .leading, spacing: 1) {
                        Text(event.tool ?? event.type ?? "event")
                            .font(.caption)
                            .fontWeight(.medium)
                            .lineLimit(1)
                        Text(event.displayText)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }

                    Spacer()

                    // Allowed/denied badge
                    if event.allowed == 0 {
                        Text("BLOCKED")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(.red, in: Capsule())
                    }

                    Text(event.timeAgoText)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)

                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if expanded, let reasoning = event.safeguard?.reasoning {
                Text(reasoning)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)
                    .padding(.leading, 28)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(expanded ? riskColor.opacity(0.05) : .clear)
        )
    }
}
