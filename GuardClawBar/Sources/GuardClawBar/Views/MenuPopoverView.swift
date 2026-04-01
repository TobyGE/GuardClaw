import SwiftUI

struct MenuPopoverView: View {
    @Bindable var appState: AppState
    private var L: Loc { Loc.shared }

    var body: some View {
        VStack(spacing: 0) {
            headerView
            let checker = appState.updateChecker
            if checker.updateAvailable || checker.isWorking {
                updateBanner(checker: checker)
                Divider()
            }
            ProviderTabView(appState: appState)
            Divider()
            FooterView(appState: appState)
        }
        .frame(width: 360, height: 520)
    }

    // MARK: - Update Banner

    @ViewBuilder
    private func updateBanner(checker: UpdateChecker) -> some View {
        HStack(spacing: 8) {
            switch checker.phase {
            case .available(let version, _):
                Image(systemName: "arrow.down.circle.fill")
                    .foregroundStyle(.blue)
                Text("Update available: \(version)")
                    .font(.caption)
                    .fontWeight(.medium)
                Spacer()
                Button("Install") {
                    Task { await checker.downloadAndInstall() }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                Button {
                    checker.dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)

            case .downloading(let progress):
                Image(systemName: "arrow.down.circle")
                    .foregroundStyle(.blue)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Downloading update…")
                        .font(.caption)
                    ProgressView(value: progress)
                        .progressViewStyle(.linear)
                        .frame(width: 140)
                }
                Spacer()

            case .installing:
                ProgressView()
                    .controlSize(.small)
                Text("Installing… app will restart")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()

            default:
                EmptyView()
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color.blue.opacity(0.08))
    }

    // MARK: - Header

    private var haikuCostString: String? {
        guard let usage = appState.serverStatus?.tokenUsage,
              let prompt = usage.promptTokens, let completion = usage.completionTokens,
              prompt + completion > 0 else { return nil }
        let cost = Double(prompt) / 1_000_000.0 * 0.25 + Double(completion) / 1_000_000.0 * 1.25
        if cost < 0.01 { return String(format: "$%.4f", cost) }
        return String(format: "$%.2f", cost)
    }

    private var headerView: some View {
        HStack(spacing: 8) {
            // Mini shield icon
            Image(nsImage: IconRenderer.render(status: .normal, badgeCount: 0))
                .resizable()
                .frame(width: 20, height: 20)

            Text(L.t("header.title"))
                .font(.headline)
                .fontWeight(.bold)

            if appState.daysProtected > 0 {
                Text("\(appState.daysProtected)\(L.t("header.daysSuffix"))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.quaternary)
                    .clipShape(Capsule())
            }

            if let cost = haikuCostString {
                Text("≈ \(cost) \(L.t("header.saved"))")
                    .font(.caption2)
                    .foregroundStyle(.green)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.green.opacity(0.1))
                    .clipShape(Capsule())
            }

            Spacer()

            Circle()
                .fill(appState.connectionDotColor)
                .frame(width: 8, height: 8)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
