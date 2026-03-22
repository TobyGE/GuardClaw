import SwiftUI

struct ActivityView: View {
    @Environment(AppState.self) var appState
    @State private var selectedBackend: String = "claude-code"
    @State private var displayLimit: Int = 200
    private var L: Loc { Loc.shared }

    private let backends = [
        ("claude-code", "Claude Code"),
        ("openclaw", "OpenClaw"),
        ("gemini-cli", "Gemini CLI"),
        ("copilot", "Copilot CLI"),
        ("cursor", "Cursor"),
        ("opencode", "OpenCode"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            // Backend picker
            Picker(L.t("activity.backend"), selection: $selectedBackend) {
                ForEach(backends, id: \.0) { key, label in
                    Text(label).tag(key)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            Divider()

            let allEvents = appState.eventsForBackend(selectedBackend)
                .sorted(by: { ($0.timestamp ?? 0) > ($1.timestamp ?? 0) })
            if allEvents.isEmpty {
                ContentUnavailableView(
                    L.t("activity.noActivity"),
                    systemImage: "list.bullet.rectangle",
                    description: Text(L.t("activity.noActivityDesc"))
                )
            } else {
                let visibleEvents = Array(allEvents.prefix(displayLimit))
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(visibleEvents, id: \.stableId) { event in
                            ToolCallRow(event: event)
                        }

                        if allEvents.count > displayLimit {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                                .padding(8)
                                .onAppear { displayLimit += 200 }
                        }
                    }
                    .padding(12)
                }
            }
        }
        .navigationTitle(L.t("activity.title"))
        .onChange(of: selectedBackend) { _, _ in displayLimit = 200 }
    }

}

struct ToolCallRow: View {
    let event: EventItem
    @State private var expanded = false
    @State private var markState: MarkState = .none
    private var L: Loc { Loc.shared }

    enum MarkState { case none, allow, deny }

    private var riskScore: Double { event.effectiveRiskScore }

    private var riskColor: Color {
        if riskScore >= 8 { return .red }
        if riskScore >= 4 { return .orange }
        return .green
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
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
                    Text(L.t("common.blocked"))
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(.red, in: Capsule())
                }

                // Mark allow / deny toggle buttons
                if let tool = event.tool {
                    HStack(spacing: 4) {
                        Button {
                            Task {
                                let newState: MarkState = markState == .allow ? .none : .allow
                                _ = try? await GuardClawAPI().markDecision(
                                    toolName: tool, command: event.displayText,
                                    decision: newState == .allow ? "approve" : "neutral"
                                )
                                markState = newState
                            }
                        } label: {
                            Text(L.t("activity.markAllow"))
                                .font(.system(size: 9, weight: .medium))
                                .foregroundStyle(markState == .allow ? .white : .green)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(
                                    markState == .allow ? Color.green : Color.green.opacity(0.15),
                                    in: Capsule()
                                )
                        }
                        .buttonStyle(.plain)

                        Button {
                            Task {
                                let newState: MarkState = markState == .deny ? .none : .deny
                                _ = try? await GuardClawAPI().markDecision(
                                    toolName: tool, command: event.displayText,
                                    decision: newState == .deny ? "deny" : "neutral"
                                )
                                markState = newState
                            }
                        } label: {
                            Text(L.t("activity.markDeny"))
                                .font(.system(size: 9, weight: .medium))
                                .foregroundStyle(markState == .deny ? .white : .red)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(
                                    markState == .deny ? Color.red : Color.red.opacity(0.15),
                                    in: Capsule()
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }

                Text(event.timeAgoText)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)

                Button {
                    withAnimation(.easeInOut(duration: 0.15)) { expanded.toggle() }
                } label: {
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
            }

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
