import SwiftUI

struct MenuPopoverView: View {
    @Bindable var appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            headerView
            Divider()
            ProviderTabView(appState: appState)
            Divider()
            FooterView(appState: appState)
        }
        .frame(width: 360, height: 520)
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

            Text("GuardClaw")
                .font(.headline)
                .fontWeight(.bold)

            if appState.daysProtected > 0 {
                Text("\(appState.daysProtected)d")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.quaternary)
                    .clipShape(Capsule())
            }

            if let cost = haikuCostString {
                Text("≈ \(cost) saved")
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
