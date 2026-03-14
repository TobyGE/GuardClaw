import SwiftUI

struct MemoryView: View {
    @State private var stats: MemoryStatsResponse? = nil
    @State private var patterns: [MemoryPattern] = []
    @State private var isLoading = true
    @State private var showResetConfirm = false
    @State private var statusMessage: String? = nil
    @State private var sortOrder = SortOrder.confidence
    private var L: Loc { Loc.shared }

    enum SortOrder: String, CaseIterable {
        case confidence = "confidence"
        case total = "total"
        case tool = "tool"

        func localizedName() -> String {
            switch self {
            case .confidence: return Loc.shared.t("memory.confidence")
            case .total: return Loc.shared.t("memory.totalDecisions")
            case .tool: return Loc.shared.t("memory.toolName")
            }
        }
    }

    private let api = GuardClawAPI()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Stats cards
                if let s = stats {
                    statsRow(s)
                }

                // Patterns table
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(L.t("memory.learnedPatterns"))
                            .font(.headline)
                        Spacer()
                        Picker(L.t("memory.sort"), selection: $sortOrder) {
                            ForEach(SortOrder.allCases, id: \.self) { order in
                                Text(order.localizedName()).tag(order)
                            }
                        }
                        .pickerStyle(.menu)
                        .controlSize(.small)
                    }

                    if isLoading {
                        HStack { ProgressView().controlSize(.small); Text(L.t("common.loading")).font(.caption) }
                    } else if sortedPatterns.isEmpty {
                        ContentUnavailableView(
                            L.t("memory.noPatterns"),
                            systemImage: "brain",
                            description: Text(L.t("memory.noPatternsDesc"))
                        )
                        .frame(height: 160)
                    } else {
                        VStack(spacing: 4) {
                            ForEach(sortedPatterns) { pattern in
                                PatternRow(pattern: pattern)
                            }
                        }
                    }
                }

                if let msg = statusMessage {
                    Text(msg)
                        .font(.caption)
                        .foregroundStyle(msg.contains("\u{2713}") ? .green : .red)
                }

                // Reset button
                HStack {
                    Spacer()
                    Button(role: .destructive) {
                        showResetConfirm = true
                    } label: {
                        Label(L.t("memory.resetAll"), systemImage: "trash")
                    }
                    .buttonStyle(.bordered)
                    .tint(.red)
                }
            }
            .padding(24)
        }
        .navigationTitle(L.t("memory.title"))
        .confirmationDialog(L.t("memory.resetConfirm"), isPresented: $showResetConfirm, titleVisibility: .visible) {
            Button(L.t("memory.resetButton"), role: .destructive) { Task { await resetMemory() } }
            Button(L.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(L.t("memory.resetWarning"))
        }
        .onAppear { refresh() }
    }

    private func statsRow(_ s: MemoryStatsResponse) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            StatCard(title: L.t("memory.totalDecisions"), value: "\(s.totalDecisions ?? 0)", icon: "brain", color: .blue)
            StatCard(title: L.t("memory.learnedPatterns"), value: "\(s.totalPatterns ?? 0)", icon: "list.bullet", color: .purple)
            StatCard(title: L.t("memory.autoApprove"), value: "\(s.autoApproveCount ?? 0)", icon: "bolt.circle", color: .green)
        }
    }

    private var sortedPatterns: [MemoryPattern] {
        switch sortOrder {
        case .confidence: return patterns.sorted { ($0.confidence ?? 0) > ($1.confidence ?? 0) }
        case .total: return patterns.sorted { $0.total > $1.total }
        case .tool: return patterns.sorted { ($0.tool ?? "") < ($1.tool ?? "") }
        }
    }

    private func refresh() {
        isLoading = true
        Task {
            async let statsResult = api.memoryStats()
            async let patternsResult = api.memoryPatterns()
            stats = try? await statsResult
            if let resp = try? await patternsResult {
                patterns = resp.patterns
            }
            isLoading = false
        }
    }

    private func resetMemory() async {
        do {
            _ = try await api.memoryReset()
            patterns = []
            stats = nil
            statusMessage = "\u{2713} " + L.t("memory.cleared")
            refresh()
        } catch {
            statusMessage = L.t("settings.failed", error.localizedDescription)
        }
    }
}

struct PatternRow: View {
    let pattern: MemoryPattern
    private var L: Loc { Loc.shared }

    private var approveColor: Color {
        pattern.approveRate > 0.7 ? .green : pattern.approveRate > 0.3 ? .orange : .red
    }

    var body: some View {
        HStack(spacing: 10) {
            // Auto-approve indicator
            if pattern.isAutoApprove {
                Image(systemName: "bolt.circle.fill")
                    .foregroundStyle(.green)
                    .font(.caption)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(pattern.tool ?? "unknown")
                    .font(.caption)
                    .fontWeight(.semibold)
                if let cmd = pattern.commandPattern {
                    Text(cmd)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .fontDesign(.monospaced)
                }
            }

            Spacer()

            // Stats
            VStack(alignment: .trailing, spacing: 2) {
                HStack(spacing: 4) {
                    Text("\(pattern.approveCount ?? 0)\u{2713}")
                        .font(.caption2)
                        .foregroundStyle(.green)
                    Text("\(pattern.denyCount ?? 0)\u{2717}")
                        .font(.caption2)
                        .foregroundStyle(.red)
                }
                Text(L.t("memory.confidencePercent", Int((pattern.confidence ?? 0) * 100)))
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
    }
}
