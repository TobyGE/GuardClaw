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
    private var L: Loc { Loc.shared }

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
    private var presets: [(String, String, String)] {
        [
            // (label, pattern, list type)
            (L.t("rules.allowFileReads"), "Read", "whitelist"),
            (L.t("rules.allowSearches"), "Grep,Glob", "whitelist"),
            (L.t("rules.allowGit"), "Bash:git status,Bash:git log,Bash:git diff", "whitelist"),
            (L.t("rules.blockRmRf"), "Bash:rm -rf", "blacklist"),
            (L.t("rules.blockCurlWget"), "Bash:curl -X POST,Bash:wget --post", "blacklist"),
            (L.t("rules.blockSSH"), "Read:~/.ssh", "blacklist"),
            (L.t("rules.blockEnv"), "Read:.env", "blacklist"),
        ]
    }

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
                    title: L.t("rules.whitelist"),
                    subtitle: L.t("rules.whitelistDesc"),
                    icon: "checkmark.circle",
                    color: .green,
                    patterns: whitelist,
                    newPattern: $newWhitelistPattern,
                    onAdd: addToWhitelist,
                    onRemove: removeFromWhitelist
                )

                // Blacklist
                patternSection(
                    title: L.t("rules.blacklist"),
                    subtitle: L.t("rules.blacklistDesc"),
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
                        .foregroundStyle(msg.contains("\u{2713}") ? .green : .red)
                }

                // Help text
                GroupBox {
                    Text(L.t("rules.patternsHelp"))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } label: {
                    Label(L.t("rules.howPatternsWork"), systemImage: "info.circle").font(.caption)
                }
            }
            .padding(24)
        }
        .navigationTitle(L.t("rules.title"))
        .onAppear { refresh() }
    }

    // MARK: - Suggestions

    private var suggestionsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(L.t("rules.suggestedRules"), systemImage: "lightbulb")
                .font(.headline)
                .foregroundStyle(.orange)

            HStack {
                Text(L.t("rules.basedOnHistory"))
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
                        Text(L.t("rules.aiSuggest"))
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

                    Button(s.type == "whitelist" ? L.t("rules.allow") : L.t("rules.block")) {
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
            Label(L.t("rules.quickPresets"), systemImage: "sparkles")
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
                TextField(L.t("rules.patternPlaceholder"), text: newPattern)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await onAdd() } }

                Button(L.t("common.add")) { Task { await onAdd() } }
                    .disabled(newPattern.wrappedValue.trimmingCharacters(in: .whitespaces).isEmpty)
                    .buttonStyle(.borderedProminent)
                    .tint(color)
                    .controlSize(.small)
            }

            if patterns.isEmpty {
                Text(L.t("rules.noPatterns"))
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
                statusMessage = L.t("rules.noAISuggestions")
            } else {
                suggestions.append(contentsOf: newOnes)
            }
        } catch {
            statusMessage = L.t("rules.aiSuggestionFailed", error.localizedDescription)
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
            statusMessage = "\u{2713} " + L.t("rules.addedTo", pattern, s.type)
        } catch {
            statusMessage = L.t("settings.failed", error.localizedDescription)
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
                statusMessage = L.t("settings.failed", error.localizedDescription)
                return
            }
        }
        statusMessage = "\u{2713} " + L.t("rules.presetApplied")
    }

    private func addToWhitelist() async {
        let pattern = newWhitelistPattern.trimmingCharacters(in: .whitespaces)
        guard !pattern.isEmpty else { return }
        do {
            let resp = try await api.addToWhitelist(pattern: pattern)
            whitelist = resp.whitelist ?? whitelist
            newWhitelistPattern = ""
            statusMessage = "\u{2713} " + L.t("rules.addedWhitelist")
        } catch {
            statusMessage = L.t("settings.failed", error.localizedDescription)
        }
    }

    private func removeFromWhitelist(_ pattern: String) async {
        do {
            let resp = try await api.removeFromWhitelist(pattern: pattern)
            whitelist = resp.whitelist ?? whitelist.filter { $0 != pattern }
        } catch {
            statusMessage = L.t("settings.failed", error.localizedDescription)
        }
    }

    private func addToBlacklist() async {
        let pattern = newBlacklistPattern.trimmingCharacters(in: .whitespaces)
        guard !pattern.isEmpty else { return }
        do {
            let resp = try await api.addToBlacklist(pattern: pattern)
            blacklist = resp.blacklist ?? blacklist
            newBlacklistPattern = ""
            statusMessage = "\u{2713} " + L.t("rules.addedBlacklist")
        } catch {
            statusMessage = L.t("settings.failed", error.localizedDescription)
        }
    }

    private func removeFromBlacklist(_ pattern: String) async {
        do {
            let resp = try await api.removeFromBlacklist(pattern: pattern)
            blacklist = resp.blacklist ?? blacklist.filter { $0 != pattern }
        } catch {
            statusMessage = L.t("settings.failed", error.localizedDescription)
        }
    }
}
