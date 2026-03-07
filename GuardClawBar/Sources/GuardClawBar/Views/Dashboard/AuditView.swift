import SwiftUI

struct AuditView: View {
    @State private var findings: [AuditFinding] = []
    @State private var summary: AuditSummary? = nil
    @State private var isScanning = false
    @State private var hasScanned = false
    @State private var errorMessage: String? = nil
    @State private var expandedId: String? = nil

    private let api = GuardClawAPI()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Security Audit")
                                .font(.headline)
                            Text("Static analysis powered by agent-audit. Scans MCP configs, credentials, code vulnerabilities, and OWASP Agentic Top 10.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button {
                            Task { await runScan() }
                        } label: {
                            Label(isScanning ? "Scanning..." : "Run Scan", systemImage: isScanning ? "progress.indicator" : "play.fill")
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(isScanning)
                    }
                }
                .padding(16)
                .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))

                // Summary
                if let summary, hasScanned {
                    summarySection(summary)
                }

                // Findings
                if !findings.isEmpty {
                    findingsSection
                } else if hasScanned && !isScanning {
                    ContentUnavailableView(
                        "No Issues Found",
                        systemImage: "checkmark.shield",
                        description: Text("Your configuration looks clean")
                    )
                    .frame(height: 200)
                } else if !hasScanned && !isScanning {
                    ContentUnavailableView(
                        "Not Scanned Yet",
                        systemImage: "magnifyingglass",
                        description: Text("Click Run Scan to analyze your agent configuration")
                    )
                    .frame(height: 200)
                }

                if isScanning {
                    HStack {
                        ProgressView().controlSize(.small)
                        Text("Scanning ~/.claude and project files...")
                            .font(.caption)
                            .foregroundStyle(.secondary)
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
        .navigationTitle("Security Scan")
        .task {
            await loadCachedResults()
        }
    }

    private func loadCachedResults() async {
        do {
            let resp = try await api.auditResults()
            if resp.ok == true {
                findings = resp.findings.sorted { severityRank($0.severity) < severityRank($1.severity) }
                summary = resp.summary
                hasScanned = true
            }
        } catch {}
    }

    // MARK: - Summary

    private func summarySection(_ s: AuditSummary) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 16) {
                summaryPill(label: "Tools", value: "\(s.totalTools ?? 0)", color: .blue)
                summaryPill(label: "Skills", value: "\(s.totalSkills ?? 0)", color: .blue)
                summaryPill(
                    label: "Risky Tools",
                    value: "\(s.dangerousTools ?? 0)",
                    color: (s.dangerousTools ?? 0) > 0 ? .red : .green
                )
                summaryPill(
                    label: "Risky Skills",
                    value: "\(s.dangerousSkills ?? 0)",
                    color: (s.dangerousSkills ?? 0) > 0 ? .red : .green
                )
                Spacer()
            }

            if let bySev = s.bySeverity, !bySev.isEmpty {
                HStack(spacing: 12) {
                    if let critical = bySev["critical"], critical > 0 {
                        Text("\(critical) Critical")
                            .font(.caption2)
                            .foregroundStyle(.red)
                    }
                    if let high = bySev["high"], high > 0 {
                        Text("\(high) High")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                    if let medium = bySev["medium"], medium > 0 {
                        Text("\(medium) Medium")
                            .font(.caption2)
                            .foregroundStyle(.yellow)
                    }
                    Spacer()
                }
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
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
        VStack(alignment: .leading, spacing: 8) {
            Text("Findings")
                .font(.headline)

            ForEach(findings) { finding in
                findingRow(finding)
            }
        }
    }

    private func findingRow(_ f: AuditFinding) -> some View {
        let isExpanded = expandedId == f.id
        let color = severityColor(f.severity)

        return VStack(alignment: .leading, spacing: 0) {
            // Header row
            HStack(spacing: 8) {
                // Severity dot
                Circle()
                    .fill(color)
                    .frame(width: 8, height: 8)

                // Title + source context
                VStack(alignment: .leading, spacing: 2) {
                    Text(f.title ?? "")
                        .font(.caption)
                        .fontWeight(.medium)
                        .lineLimit(1)
                    HStack(spacing: 4) {
                        if let source = f.source {
                            Text(source)
                                .font(.system(size: 9, weight: .medium))
                                .foregroundStyle(.blue)
                        }
                        if let name = f.sourceName ?? f.skillName {
                            Text(name)
                                .font(.system(size: 9, weight: .medium, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Spacer()

                // Severity label
                Text(f.severity?.capitalized ?? "")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(color)

                Button {
                    withAnimation(.easeInOut(duration: 0.15)) {
                        expandedId = isExpanded ? nil : f.id
                    }
                } label: {
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
            }

            // Expanded detail
            if isExpanded {
                VStack(alignment: .leading, spacing: 6) {
                    if let desc = f.description {
                        Text(desc)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    if let filePath = f.filePath {
                        let short = filePath
                            .replacingOccurrences(of: NSHomeDirectory(), with: "~")
                            .replacingOccurrences(of: "~/.claude/plugins/marketplaces/claude-plugins-official/", with: "plugins/")
                        HStack(spacing: 4) {
                            Image(systemName: "doc.text")
                                .font(.caption2)
                            Text("\(short):\(f.line ?? 0)")
                                .font(.caption2)
                                .fontDesign(.monospaced)
                        }
                        .foregroundStyle(.blue)
                    }

                    if let snippet = f.snippet, !snippet.isEmpty {
                        Text(snippet)
                            .font(.system(size: 10, design: .monospaced))
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))
                    }

                    if let remediation = f.remediation {
                        HStack(alignment: .top, spacing: 4) {
                            Image(systemName: "lightbulb")
                                .font(.caption2)
                                .foregroundStyle(.orange)
                            Text(remediation)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }

                    HStack(spacing: 12) {
                        if let ruleId = f.ruleId {
                            Text(ruleId).font(.system(size: 9, weight: .medium, design: .monospaced)).foregroundStyle(.tertiary)
                        }
                        if let cwe = f.cweId {
                            Text(cwe).font(.system(size: 9, weight: .medium)).foregroundStyle(.tertiary)
                        }
                        if let owasp = f.owaspId {
                            Text(owasp).font(.system(size: 9, weight: .medium)).foregroundStyle(.purple.opacity(0.6))
                        }
                        if let conf = f.confidence {
                            Text("\(String(format: "%.0f%%", conf * 100)) confidence")
                                .font(.system(size: 9)).foregroundStyle(.tertiary)
                        }
                    }
                }
                .padding(.top, 8)
                .padding(.leading, 4)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(isExpanded ? color.opacity(0.05) : Color.gray.opacity(0.1))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(isExpanded ? color.opacity(0.3) : .clear, lineWidth: 1)
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
        errorMessage = nil
        do {
            let resp = try await api.auditScan()
            findings = resp.findings.sorted { severityRank($0.severity) < severityRank($1.severity) }
            summary = resp.summary
            hasScanned = true
            if let err = resp.error {
                errorMessage = err
            }
        } catch {
            errorMessage = "Scan failed: \(error.localizedDescription)"
            hasScanned = true
        }
        isScanning = false
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
