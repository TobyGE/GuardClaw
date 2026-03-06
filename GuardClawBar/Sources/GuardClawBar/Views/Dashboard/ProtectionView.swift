import SwiftUI

struct ProtectionView: View {
    @State private var blockingEnabled = false
    @State private var failClosed = false
    @State private var isLoading = true
    @State private var statusMessage: String? = nil

    private let api = GuardClawAPI()
    private let timer = Timer.publish(every: 3, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Active Blocking Card
                protectionCard(
                    title: "Active Blocking",
                    icon: "shield.slash",
                    description: blockingEnabled
                        ? "Risky tool calls require approval before executing."
                        : "Monitor only — GuardClaw watches but doesn't block anything.",
                    color: blockingEnabled ? .green : .orange,
                    isOn: $blockingEnabled,
                    onToggle: toggleBlocking
                )

                // Fail-Closed Card
                protectionCard(
                    title: "Fail-Closed (Offline)",
                    icon: "lock.fill",
                    description: failClosed
                        ? "If the judge is unreachable, all tool calls are BLOCKED."
                        : "If the judge is unreachable, tool calls proceed (fail-open).",
                    color: failClosed ? .blue : .gray,
                    isOn: $failClosed,
                    onToggle: toggleFailClosed
                )

                if isLoading {
                    HStack { ProgressView().controlSize(.small); Text("Loading...").font(.caption) }
                }

                if let msg = statusMessage {
                    Text(msg)
                        .font(.caption)
                        .foregroundStyle(msg.contains("✓") ? .green : .orange)
                }

                // Explanation
                GroupBox {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Strict", systemImage: "shield.checkered").font(.caption).fontWeight(.semibold)
                        Text("Active Blocking + Fail-Closed. Maximum protection.")
                            .font(.caption2).foregroundStyle(.secondary)
                        Divider()
                        Label("Balanced", systemImage: "shield.lefthalf.filled").font(.caption).fontWeight(.semibold)
                        Text("Active Blocking + Fail-Open. Protection with availability fallback.")
                            .font(.caption2).foregroundStyle(.secondary)
                        Divider()
                        Label("Monitor Only", systemImage: "eye").font(.caption).fontWeight(.semibold)
                        Text("No blocking. GuardClaw logs and alerts without intervening.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                } label: {
                    Text("Presets").font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(24)
        }
        .navigationTitle("Protection")
        .onAppear { refresh() }
        .onReceive(timer) { _ in refresh() }
    }

    private func protectionCard(title: String, icon: String, description: String, color: Color, isOn: Binding<Bool>, onToggle: @escaping (Bool) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(title, systemImage: icon)
                    .font(.headline)
                Spacer()
                Toggle("", isOn: Binding(
                    get: { isOn.wrappedValue },
                    set: { onToggle($0) }
                ))
                .toggleStyle(.switch)
            }
            Text(description)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(color.opacity(isOn.wrappedValue ? 0.4 : 0.1), lineWidth: 1.5)
        )
    }

    private func refresh() {
        Task {
            if let s = try? await api.status() {
                blockingEnabled = s.approvals?.mode == "blocking"
                failClosed = s.failClosed == true
                isLoading = false
            }
        }
    }

    private func toggleBlocking(_ newVal: Bool) {
        blockingEnabled = newVal
        Task {
            do {
                _ = try await api.toggleBlocking(enabled: newVal)
                statusMessage = "✓ Blocking \(newVal ? "enabled" : "disabled")"
            } catch {
                blockingEnabled = !newVal
                statusMessage = "Failed: \(error.localizedDescription)"
            }
        }
    }

    private func toggleFailClosed(_ newVal: Bool) {
        failClosed = newVal
        Task {
            do {
                _ = try await api.toggleFailClosed(enabled: newVal)
                statusMessage = "✓ Fail-closed \(newVal ? "enabled" : "disabled")"
            } catch {
                failClosed = !newVal
                statusMessage = "Failed: \(error.localizedDescription)"
            }
        }
    }
}
