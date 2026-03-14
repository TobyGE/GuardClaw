import SwiftUI

struct BarAuditSection: View {
    @State private var findings: [AuditFinding] = []
    @State private var isScanning = false
    @State private var hasScanned = false
    private var L: Loc { Loc.shared }

    private let api = GuardClawAPI()

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass.circle")
                    .font(.caption)
                    .foregroundStyle(.purple)
                Text(L.t("barAudit.securityAudit"))
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)

                Spacer()

                if hasScanned {
                    let critical = findings.filter { $0.severity == "critical" }.count
                    let high = findings.filter { $0.severity == "high" }.count

                    if critical + high == 0 && findings.isEmpty {
                        HStack(spacing: 3) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.caption2)
                                .foregroundStyle(.green)
                            Text(L.t("common.clean"))
                                .font(.caption2)
                                .foregroundStyle(.green)
                        }
                    } else {
                        HStack(spacing: 4) {
                            if critical > 0 {
                                Text(L.t("barAudit.crit", critical))
                                    .font(.system(size: 8, weight: .bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 1)
                                    .background(.red, in: Capsule())
                            }
                            if high > 0 {
                                Text(L.t("barAudit.high", high))
                                    .font(.system(size: 8, weight: .bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 1)
                                    .background(.orange, in: Capsule())
                            }
                            let other = findings.count - critical - high
                            if other > 0 {
                                Text("+\(other)")
                                    .font(.system(size: 8, weight: .medium))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                Button {
                    Task { await runScan() }
                } label: {
                    if isScanning {
                        ProgressView().controlSize(.mini)
                    } else {
                        Image(systemName: "play.fill")
                            .font(.system(size: 9))
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(.blue)
                .disabled(isScanning)
            }

            // Show top findings inline
            if hasScanned && !findings.isEmpty {
                ForEach(findings.prefix(3)) { f in
                    HStack(spacing: 6) {
                        Circle()
                            .fill(severityColor(f.severity))
                            .frame(width: 6, height: 6)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(f.title ?? "")
                                .font(.system(size: 9, weight: .medium))
                                .lineLimit(1)
                            HStack(spacing: 4) {
                                if let source = f.source {
                                    Text(source)
                                        .font(.system(size: 8, weight: .medium))
                                        .foregroundStyle(.blue)
                                }
                                if let name = f.sourceName ?? f.skillName {
                                    Text(name)
                                        .font(.system(size: 8))
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        Spacer()
                    }
                }

                if findings.count > 3 {
                    Button(L.t("barAudit.viewAll", findings.count)) {
                        AppDelegate.shared?.openDashboard()
                    }
                    .font(.caption2)
                    .foregroundStyle(.blue)
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private func shortPath(_ path: String?) -> String {
        guard let path else { return "" }
        let short = path.replacingOccurrences(of: NSHomeDirectory(), with: "~")
        // Further shorten known long prefixes
        return short
            .replacingOccurrences(of: "~/.claude/plugins/marketplaces/claude-plugins-official/", with: "plugins/")
            .replacingOccurrences(of: "~/.claude/", with: ".claude/")
    }

    private func severityColor(_ s: String?) -> Color {
        switch s {
        case "critical": return .red
        case "high": return .orange
        case "medium": return .yellow
        default: return .gray
        }
    }

    private func runScan() async {
        isScanning = true
        defer { isScanning = false }
        do {
            let resp = try await api.auditScan()
            findings = resp.findings.sorted {
                severityRank($0.severity) < severityRank($1.severity)
            }
            hasScanned = true
        } catch {
            hasScanned = true
        }
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
