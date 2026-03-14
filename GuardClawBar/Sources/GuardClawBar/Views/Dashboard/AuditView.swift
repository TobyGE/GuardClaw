import SwiftUI

struct AuditView: View {
    @State private var findings: [AuditFinding] = []
    @State private var summary: AuditSummary? = nil
    @State private var isScanning = false
    @State private var hasScanned = false
    @State private var errorMessage: String? = nil
    @State private var scanProgressMessage: String = ""
    @State private var expandedId: String? = nil
    @State private var configChanged = false
    private var L: Loc { Loc.shared }

    private let api = GuardClawAPI()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(L.t("audit.headline"))
                                .font(.headline)
                            Text(L.t("audit.description"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button {
                            Task { await runScan() }
                        } label: {
                            Label(isScanning ? L.t("audit.scanning") : L.t("audit.runScan"), systemImage: isScanning ? "progress.indicator" : "play.fill")
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(isScanning)
                    }
                }
                .padding(16)
                .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))

                // Config changed warning
                if configChanged && hasScanned && !isScanning {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L.t("audit.configChanged"))
                                .font(.caption)
                                .fontWeight(.medium)
                            Text(L.t("audit.configChangedDesc"))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(L.t("audit.rescan")) {
                            Task { await runScan() }
                        }
                        .controlSize(.small)
                        .buttonStyle(.borderedProminent)
                        .tint(.orange)
                    }
                    .padding(12)
                    .background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(.orange.opacity(0.3), lineWidth: 1)
                    )
                }

                // Summary
                if let summary, hasScanned {
                    summarySection(summary)
                }

                // Findings
                if !findings.isEmpty {
                    findingsSection
                } else if hasScanned && !isScanning {
                    ContentUnavailableView(
                        L.t("audit.noIssues"),
                        systemImage: "checkmark.shield",
                        description: Text(L.t("audit.noIssuesDesc"))
                    )
                    .frame(height: 200)
                } else if !hasScanned && !isScanning {
                    ContentUnavailableView(
                        L.t("audit.notScanned"),
                        systemImage: "magnifyingglass",
                        description: Text(L.t("audit.notScannedDesc"))
                    )
                    .frame(height: 200)
                }

                if isScanning {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            ProgressView().controlSize(.small)
                            Text(scanProgressMessage.isEmpty ? L.t("audit.scanning") : scanProgressMessage)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        ProgressView()
                            .progressViewStyle(.linear)
                            .tint(.blue)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.blue.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
                }

                if let err = errorMessage {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
            .padding(24)
        }
        .navigationTitle(L.t("audit.title"))
        .task {
            await loadCachedResults()
        }
    }

    private func loadCachedResults() async {
        do {
            let resp = try await api.auditResults()
            findings = resp.findings.filter { $0.severity == "critical" && $0.llmVerdict != "FALSE_POSITIVE" }.sorted { severityRank($0.severity) < severityRank($1.severity) }
            if let s = resp.summary { summary = s }
            hasScanned = resp.summary != nil
            configChanged = resp.configChanged == true
        } catch {}
    }

    // MARK: - Summary

    private func summarySection(_ s: AuditSummary) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 16) {
                summaryPill(label: L.t("audit.tools"), value: "\(s.totalTools ?? 0)", color: .blue)
                summaryPill(label: L.t("audit.skills"), value: "\(s.totalSkills ?? 0)", color: .blue)
                summaryPill(
                    label: L.t("audit.riskyTools"),
                    value: "\(s.dangerousTools ?? 0)",
                    color: (s.dangerousTools ?? 0) > 0 ? .red : .green
                )
                summaryPill(
                    label: L.t("audit.riskySkills"),
                    value: "\(s.dangerousSkills ?? 0)",
                    color: (s.dangerousSkills ?? 0) > 0 ? .red : .green
                )
                vulnerabilityPill(count: findings.count)
                Spacer()
            }

            // Show risky tool/skill names
            let riskyNames = (s.dangerousToolList ?? []) + (s.dangerousSkillList ?? [])
            if !riskyNames.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(.red)
                    Text(L.t("audit.riskyNames", riskyNames.joined(separator: ", ")))
                        .font(.caption2)
                        .foregroundStyle(.red)
                    Spacer()
                }
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    private func vulnerabilityPill(count: Int) -> some View {
        VStack(spacing: 2) {
            HStack(spacing: 2) {
                if count > 0 {
                    Image(systemName: "exclamationmark.shield.fill")
                        .font(.system(size: 14))
                }
                Text("\(count)")
                    .font(.title2)
                    .fontWeight(.bold)
            }
            .foregroundStyle(count > 0 ? .red : .green)
            Text(L.t("audit.vulnerabilities"))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(minWidth: 60)
    }

    private func summaryPill(label: String, value: String, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.title2)
                .fontWeight(.bold)
                .foregroundStyle(color)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(minWidth: 60)
    }

    // MARK: - Findings

    private var findingsSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(L.t("audit.findings"))
                .font(.headline)

            // Group findings by sourceName (risky tool/skill)
            let grouped = Dictionary(grouping: findings) { $0.sourceName ?? $0.source ?? "Unknown" }
            ForEach(Array(grouped.keys.sorted()), id: \.self) { key in
                if let items = grouped[key] {
                    riskyComponentCard(name: key, findings: items)
                }
            }
        }
    }

    private func riskyComponentCard(name: String, findings items: [AuditFinding]) -> some View {
        let source = items.first?.source ?? ""

        return VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.shield.fill")
                    .font(.title3)
                    .foregroundStyle(.red)

                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(.body)
                        .fontWeight(.semibold)
                    Text(L.t("audit.vulnsFound", source, items.count))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()
            }

            // Individual vulnerabilities — always visible
            ForEach(items) { f in
                VStack(alignment: .leading, spacing: 6) {
                    // Vulnerability title + file
                    HStack(spacing: 6) {
                        Circle()
                            .fill(.red)
                            .frame(width: 6, height: 6)
                        Text(f.description ?? f.title ?? "Vulnerability")
                            .font(.caption)
                            .fontWeight(.medium)
                    }

                    if let filePath = f.filePath {
                        let short = filePath
                            .replacingOccurrences(of: NSHomeDirectory(), with: "~")
                        HStack(spacing: 4) {
                            Image(systemName: "doc.text")
                                .font(.caption2)
                            Text("\(short):\(f.line ?? 0)")
                                .font(.system(size: 10, design: .monospaced))
                        }
                        .foregroundStyle(.blue)
                    }

                    if let snippet = f.snippet, !snippet.isEmpty {
                        Text(snippet)
                            .font(.system(size: 9, design: .monospaced))
                            .padding(6)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 4))
                    }

                    // LLM explanation per vulnerability
                    if let explanation = f.llmExplanation {
                        HStack(alignment: .top, spacing: 6) {
                            Image(systemName: "brain.head.profile")
                                .font(.caption2)
                                .foregroundStyle(.orange)
                            Text(explanation)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .padding(6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
                    }
                }
                .padding(10)
                .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
            }

            // Action buttons
            HStack(spacing: 12) {
                Button {
                    // TODO: block this extension
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "hand.raised.fill")
                            .font(.caption2)
                        Text(L.t("audit.blockExtension"))
                            .font(.caption)
                            .fontWeight(.medium)
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.red, in: Capsule())
                }
                .buttonStyle(.plain)

                Button {
                    // TODO: uninstall this extension
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "trash")
                            .font(.caption2)
                        Text(L.t("common.uninstall"))
                            .font(.caption)
                            .fontWeight(.medium)
                    }
                    .foregroundStyle(.red)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.red.opacity(0.1), in: Capsule())
                }
                .buttonStyle(.plain)

                Spacer()
            }
        }
        .padding(16)
        .background(.red.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(.red.opacity(0.2), lineWidth: 1)
        )
    }


    private func severityColor(_ severity: String?) -> Color {
        switch severity {
        case "critical": return .red
        case "high": return .orange
        case "medium": return .yellow
        default: return .gray
        }
    }

    // MARK: - Actions

    private func runScan() async {
        isScanning = true
        scanProgressMessage = L.t("download.startingScan")
        errorMessage = nil

        // Poll progress in background
        let progressTask = Task {
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(1))
                } catch { break }
                if let p = try? await api.auditProgress(), let msg = p.message, !msg.isEmpty {
                    await MainActor.run { scanProgressMessage = msg }
                }
            }
        }

        do {
            let resp = try await api.auditScan()
            findings = resp.findings.filter { $0.severity == "critical" && $0.llmVerdict != "FALSE_POSITIVE" }.sorted { severityRank($0.severity) < severityRank($1.severity) }
            summary = resp.summary
            hasScanned = true
            configChanged = false
            if let err = resp.error {
                errorMessage = err
            }
        } catch {
            errorMessage = L.t("audit.scanFailed", error.localizedDescription)
            hasScanned = true
        }

        progressTask.cancel()
        isScanning = false
        scanProgressMessage = ""
    }

    private func severityRank(_ s: String?) -> Int {
        switch s {
        case "critical": return 0
        case "high": return 1
        case "medium": return 2
        default: return 3
        }
    }
}
