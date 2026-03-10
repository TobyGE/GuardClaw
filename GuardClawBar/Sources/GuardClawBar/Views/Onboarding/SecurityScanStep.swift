import SwiftUI

struct SecurityScanStep: View {
    @Environment(AppState.self) var appState
    @State private var scanResult: SecurityScanResponse? = nil
    @State private var isScanning = false
    @State private var errorMessage: String? = nil
    @State private var expandedIds: Set<String> = []

    private let api = GuardClawAPI()

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                VStack(spacing: 6) {
                    Text("Security Check")
                        .font(.title2)
                        .fontWeight(.bold)
                    Text("Deep scan of all agent configs: Claude Code, OpenClaw, Gemini CLI, and Cursor.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                if let result = displayResult {
                    // Summary
                    if let summary = result.summary {
                        VStack(spacing: 8) {
                            HStack(spacing: 16) {
                                SummaryItem(value: "\(summary.mcpServers ?? 0)", label: "MCP Servers")
                                SummaryItem(value: "\(summary.skills ?? 0)", label: "Skills")
                                SummaryItem(value: "\(summary.hooks ?? 0)", label: "Hooks")
                            }
                            HStack(spacing: 16) {
                                SummaryItem(value: "\(summary.ocComponents ?? 0)", label: "OpenClaw")
                                SummaryItem(value: "\(summary.geminiComponents ?? 0)", label: "Gemini CLI")
                                SummaryItem(value: "\(summary.cursorComponents ?? 0)", label: "Cursor")
                                SummaryItem(value: "\(summary.total ?? 0)", label: "Issues")
                            }
                        }
                        .padding(12)
                        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
                    }

                    // Findings
                    if let findings = result.findings, !findings.isEmpty {
                        VStack(spacing: 8) {
                            ForEach(findings, id: \.displayId) { finding in
                                FindingRow(finding: finding, isExpanded: expandedIds.contains(finding.displayId)) {
                                    if expandedIds.contains(finding.displayId) {
                                        expandedIds.remove(finding.displayId)
                                    } else {
                                        expandedIds.insert(finding.displayId)
                                    }
                                }
                            }
                        }
                    } else {
                        Label("No security concerns found", systemImage: "checkmark.shield.fill")
                            .foregroundStyle(.green)
                            .font(.subheadline)
                    }
                } else if isScanning || appState.isSecurityScanning {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("Scanning skills, hooks, MCP servers, and plugin code...")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(24)
                } else {
                    Button {
                        Task { await runScan() }
                    } label: {
                        Label("Run Security Scan", systemImage: "magnifyingglass.circle.fill")
                    }
                    .buttonStyle(.borderedProminent)

                    if let err = errorMessage {
                        Text(err).font(.caption).foregroundStyle(.red)
                    }
                }
            }
            .padding(24)
        }
        .onAppear {
            // Use cached result from background scan if available
            if scanResult == nil, let cached = appState.securityScanResult {
                scanResult = cached
            }
        }
    }

    /// Use either local scan result or the one from AppState background scan
    private var displayResult: SecurityScanResponse? {
        scanResult ?? appState.securityScanResult
    }

    private func runScan() async {
        isScanning = true
        errorMessage = nil
        do {
            let result = try await api.securityScan()
            scanResult = result
            appState.securityScanResult = result
        } catch {
            errorMessage = "Scan failed: \(error.localizedDescription)"
        }
        isScanning = false
    }
}

struct SummaryItem: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 2) {
            Text(value).font(.title2).fontWeight(.bold)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

struct FindingRow: View {
    let finding: SecurityFinding
    let isExpanded: Bool
    let onToggle: () -> Void

    private var severityColor: Color {
        switch finding.severity {
        case "high": return .red
        case "medium": return .orange
        default: return .yellow
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onToggle) {
                HStack(spacing: 10) {
                    Circle()
                        .fill(severityColor)
                        .frame(width: 8, height: 8)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(finding.category ?? "").font(.caption2).foregroundStyle(.secondary).textCase(.uppercase)
                        Text(finding.title ?? "").font(.caption).fontWeight(.medium)
                    }
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2).foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(alignment: .leading, spacing: 6) {
                    if let detail = finding.detail {
                        Text(detail).font(.caption2).foregroundStyle(.secondary)
                    }
                    if let snippet = finding.snippet, !snippet.isEmpty {
                        Text(snippet)
                            .font(.system(size: 10, design: .monospaced))
                            .padding(6)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))
                    }
                    if let rec = finding.recommendation {
                        Label(rec, systemImage: "lightbulb").font(.caption2).foregroundStyle(.blue)
                    }
                }
                .padding(.top, 8)
            }
        }
        .padding(10)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(severityColor.opacity(0.2), lineWidth: 1))
    }
}
