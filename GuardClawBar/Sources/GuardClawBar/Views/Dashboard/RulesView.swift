import SwiftUI

struct RulesView: View {
    @State private var whitelist: [String] = []
    @State private var blacklist: [String] = []
    @State private var newWhitelistPattern = ""
    @State private var newBlacklistPattern = ""
    @State private var suggestions: [RuleSuggestion] = []
    @State private var statusMessage: String? = nil
    @State private var isLoading = true
    @State private var isGeneratingAI = false
    @AppStorage("guardclaw.dismissedSuggestions") private var dismissedJSON: String = "[]"

    private var dismissedIds: Set<String> {
        Set((try? JSONDecoder().decode([String].self, from: Data(dismissedJSON.utf8))) ?? [])
    }

    private func dismissSuggestion(_ id: String) {
        var ids = dismissedIds
        ids.insert(id)
        dismissedJSON = (try? String(data: JSONEncoder().encode(Array(ids)), encoding: .utf8)) ?? "[]"
        suggestions.removeAll { $0.id == id }
    }

    private var visibleSuggestions: [RuleSuggestion] {
        suggestions.filter { !dismissedIds.contains($0.id) }
    }

    private let api = GuardClawAPI()

    // Preset rule templates
    private let presets: [(String, String, String)] = [
        // (label, pattern, list type)
        ("Allow all file reads", "Read", "whitelist"),
        ("Allow Grep/Glob searches", "Grep,Glob", "whitelist"),
        ("Allow git status/log/diff", "Bash:git status,Bash:git log,Bash:git diff", "whitelist"),
        ("Block rm -rf", "Bash:rm -rf", "blacklist"),
        ("Block curl/wget uploads", "Bash:curl -X POST,Bash:wget --post", "blacklist"),
        ("Block SSH key access", "Read:~/.ssh", "blacklist"),
        ("Block .env file reads", "Read:.env", "blacklist"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Smart suggestions
                if !visibleSuggestions.isEmpty {
                    suggestionsSection
                }

                // Preset templates
                presetsSection

                // Whitelist
                patternSection(
                    title: "Whitelist",
                    subtitle: "Always auto-allowed without scoring",
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
                    subtitle: "Always auto-blocked",
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

    // MARK: - Suggestions

    private var suggestionsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Suggested Rules", systemImage: "lightbulb")
                .font(.headline)
                .foregroundStyle(.orange)

            HStack {
                Text("Based on your approve/deny history")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    Task { await generateAISuggestions() }
                } label: {
                    HStack(spacing: 4) {
                        if isGeneratingAI {
                            ProgressView().controlSize(.mini)
                        } else {
                            Image(systemName: "sparkles")
                        }
                        Text("AI Suggest")
                    }
                    .font(.caption)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(isGeneratingAI)
            }

            ForEach(visibleSuggestions) { s in
                HStack(spacing: 10) {
                    Image(systemName: s.type == "whitelist" ? "checkmark.circle" : "xmark.circle")
                        .foregroundStyle(s.type == "whitelist" ? .green : .red)
                        .font(.caption)

                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            Text(s.pattern)
                                .font(.caption)
                                .fontWeight(.medium)
                                .fontDesign(.monospaced)
                            if s.isAI {
                                Text("AI")
                                    .font(.system(size: 8, weight: .bold))
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 1)
                                    .background(.purple.opacity(0.2))
                                    .foregroundStyle(.purple)
                                    .clipShape(Capsule())
                            }
                        }
                        Text(s.reason)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Button(s.type == "whitelist" ? "Allow" : "Block") {
                        Task { await applySuggestion(s) }
                    }
                    .controlSize(.small)
                    .buttonStyle(.borderedProminent)
                    .tint(s.type == "whitelist" ? .green : .red)

                    Button {
                        dismissSuggestion(s.id)
                    } label: {
                        Image(systemName: "xmark")
                            .font(.caption2)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(.orange.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(.orange.opacity(0.3), lineWidth: 1))
    }

    // MARK: - Presets

    private var presetsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Quick Presets", systemImage: "sparkles")
                .font(.headline)
                .foregroundStyle(.blue)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(presets, id: \.0) { label, patterns, listType in
                    let alreadyAdded = patterns.split(separator: ",").allSatisfy { p in
                        listType == "whitelist"
                            ? whitelist.contains(String(p))
                            : blacklist.contains(String(p))
                    }

                    Button {
                        Task { await applyPreset(patterns: patterns, listType: listType) }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: listType == "whitelist" ? "checkmark.shield" : "xmark.shield")
                                .font(.caption)
                                .foregroundStyle(listType == "whitelist" ? .green : .red)
                            Text(label)
                                .font(.caption)
                                .lineLimit(1)
                            Spacer()
                            if alreadyAdded {
                                Image(systemName: "checkmark")
                                    .font(.caption2)
                                    .foregroundStyle(.green)
                            }
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .disabled(alreadyAdded)
                }
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
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
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(color.opacity(0.2), lineWidth: 1))
    }

    // MARK: - Actions

    private func refresh() {
        isLoading = true
        Task {
            if let status = try? await api.blockingStatus() {
                whitelist = status.whitelist ?? []
                blacklist = status.blacklist ?? []
            }
            if let resp = try? await api.ruleSuggestions() {
                suggestions = resp.suggestions
            }
            isLoading = false
        }
    }

    private func generateAISuggestions() async {
        isGeneratingAI = true
        defer { isGeneratingAI = false }
        do {
            let resp = try await api.ruleSuggestions(useLLM: true)
            let existingIds = Set(suggestions.map(\.id))
            let newOnes = resp.suggestions.filter { !existingIds.contains($0.id) && $0.isAI }
            if newOnes.isEmpty {
                statusMessage = "No AI suggestions — make sure a judge model is loaded"
            } else {
                suggestions.append(contentsOf: newOnes)
            }
        } catch {
            statusMessage = "AI suggestion failed: \(error.localizedDescription)"
        }
    }

    private func applySuggestion(_ s: RuleSuggestion) async {
        do {
            // Extract tool name from pattern like "exec:git push"
            let pattern = s.pattern
            if s.type == "whitelist" {
                let resp = try await api.addToWhitelist(pattern: pattern)
                whitelist = resp.whitelist ?? whitelist
            } else {
                let resp = try await api.addToBlacklist(pattern: pattern)
                blacklist = resp.blacklist ?? blacklist
            }
            dismissSuggestion(s.id)
            statusMessage = "✓ Added \(pattern) to \(s.type)"
        } catch {
            statusMessage = "Failed: \(error.localizedDescription)"
        }
    }

    private func applyPreset(patterns: String, listType: String) async {
        for p in patterns.split(separator: ",") {
            let pattern = String(p)
            do {
                if listType == "whitelist" {
                    let resp = try await api.addToWhitelist(pattern: pattern)
                    whitelist = resp.whitelist ?? whitelist
                } else {
                    let resp = try await api.addToBlacklist(pattern: pattern)
                    blacklist = resp.blacklist ?? blacklist
                }
            } catch {
                statusMessage = "Failed: \(error.localizedDescription)"
                return
            }
        }
        statusMessage = "✓ Preset applied"
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
