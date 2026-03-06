import SwiftUI

struct RulesView: View {
    @State private var whitelist: [String] = []
    @State private var blacklist: [String] = []
    @State private var newWhitelistPattern = ""
    @State private var newBlacklistPattern = ""
    @State private var statusMessage: String? = nil
    @State private var isLoading = true

    private let api = GuardClawAPI()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Whitelist
                patternSection(
                    title: "Whitelist",
                    subtitle: "These patterns are always auto-allowed without scoring",
                    icon: "checkmark.circle",
                    color: .green,
                    patterns: whitelist,
                    newPattern: $newWhitelistPattern,
                    onAdd: addToWhitelist,
                    onRemove: removeFromWhitelist
                )

                // Blacklist
                patternSection(
                    title: "Blacklist",
                    subtitle: "These patterns are always auto-blocked",
                    icon: "xmark.circle",
                    color: .red,
                    patterns: blacklist,
                    newPattern: $newBlacklistPattern,
                    onAdd: addToBlacklist,
                    onRemove: removeFromBlacklist
                )

                if let msg = statusMessage {
                    Text(msg)
                        .font(.caption)
                        .foregroundStyle(msg.contains("✓") ? .green : .red)
                }

                // Help text
                GroupBox {
                    Text("Patterns match tool names (e.g. \"Bash\") or tool:command pairs (e.g. \"Bash:git status\"). Whitelist overrides all scoring; blacklist blocks immediately.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } label: {
                    Label("How Patterns Work", systemImage: "info.circle").font(.caption)
                }
            }
            .padding(24)
        }
        .navigationTitle("Rules")
        .onAppear { refresh() }
    }

    // MARK: - Pattern Section

    private func patternSection(title: String, subtitle: String, icon: String, color: Color, patterns: [String], newPattern: Binding<String>, onAdd: @escaping () async -> Void, onRemove: @escaping (String) async -> Void) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: icon)
                .font(.headline)
                .foregroundStyle(color)

            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)

            // Add pattern field
            HStack(spacing: 8) {
                TextField("Tool name or pattern...", text: newPattern)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await onAdd() } }

                Button("Add") { Task { await onAdd() } }
                    .disabled(newPattern.wrappedValue.trimmingCharacters(in: .whitespaces).isEmpty)
                    .buttonStyle(.borderedProminent)
                    .tint(color)
                    .controlSize(.small)
            }

            // Pattern list
            if patterns.isEmpty {
                Text("No patterns yet")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 4)
            } else {
                VStack(spacing: 4) {
                    ForEach(patterns, id: \.self) { pattern in
                        HStack {
                            Text(pattern)
                                .font(.caption)
                                .fontDesign(.monospaced)
                            Spacer()
                            Button {
                                Task { await onRemove(pattern) }
                            } label: {
                                Image(systemName: "minus.circle.fill")
                                    .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 6))
                    }
                }
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(color.opacity(0.2), lineWidth: 1)
        )
    }

    // MARK: - Actions

    private func refresh() {
        isLoading = true
        Task {
            if let status = try? await api.blockingStatus() {
                whitelist = status.whitelist ?? []
                blacklist = status.blacklist ?? []
            }
            isLoading = false
        }
    }

    private func addToWhitelist() async {
        let pattern = newWhitelistPattern.trimmingCharacters(in: .whitespaces)
        guard !pattern.isEmpty else { return }
        do {
            let resp = try await api.addToWhitelist(pattern: pattern)
            whitelist = resp.whitelist ?? whitelist
            newWhitelistPattern = ""
            statusMessage = "✓ Added to whitelist"
        } catch {
            statusMessage = "Failed: \(error.localizedDescription)"
        }
    }

    private func removeFromWhitelist(_ pattern: String) async {
        do {
            let resp = try await api.removeFromWhitelist(pattern: pattern)
            whitelist = resp.whitelist ?? whitelist.filter { $0 != pattern }
        } catch {
            statusMessage = "Failed: \(error.localizedDescription)"
        }
    }

    private func addToBlacklist() async {
        let pattern = newBlacklistPattern.trimmingCharacters(in: .whitespaces)
        guard !pattern.isEmpty else { return }
        do {
            let resp = try await api.addToBlacklist(pattern: pattern)
            blacklist = resp.blacklist ?? blacklist
            newBlacklistPattern = ""
            statusMessage = "✓ Added to blacklist"
        } catch {
            statusMessage = "Failed: \(error.localizedDescription)"
        }
    }

    private func removeFromBlacklist(_ pattern: String) async {
        do {
            let resp = try await api.removeFromBlacklist(pattern: pattern)
            blacklist = resp.blacklist ?? blacklist.filter { $0 != pattern }
        } catch {
            statusMessage = "Failed: \(error.localizedDescription)"
        }
    }
}
