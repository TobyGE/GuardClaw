import SwiftUI
import AppKit

struct FooterView: View {
    @Bindable var appState: AppState
    @State private var showSettings = false
    private var L: Loc { Loc.shared }

    private var checker: UpdateChecker { appState.updateChecker }

    var body: some View {
        HStack(spacing: 12) {
            Button(L.t("footer.openDashboard")) {
                AppDelegate.shared?.openDashboard()
            }
            .buttonStyle(.plain)
            .font(.caption)
            .foregroundStyle(.blue)

            Spacer()

            // Check for updates button
            Button(action: {
                Task { await checker.checkForUpdates() }
            }) {
                Image(systemName: updateIcon)
                    .font(.caption)
                    .foregroundStyle(updateColor)
            }
            .buttonStyle(.plain)
            .disabled(checker.isWorking)
            .help(L.t("footer.checkUpdates"))

            Button(action: { showSettings.toggle() }) {
                Image(systemName: "gear")
                    .font(.caption)
            }
            .buttonStyle(.plain)
            .popover(isPresented: $showSettings) {
                SettingsView()
            }

            Button(action: {
                NSApplication.shared.terminate(nil)
            }) {
                Image(systemName: "power")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private var updateIcon: String {
        switch checker.phase {
        case .checking: return "arrow.triangle.2.circlepath"
        case .available: return "arrow.down.circle.fill"
        case .downloading, .installing: return "arrow.triangle.2.circlepath"
        case .done: return "checkmark.circle"
        case .error: return "exclamationmark.triangle"
        case .idle: return "arrow.triangle.2.circlepath"
        }
    }

    private var updateColor: Color {
        switch checker.phase {
        case .available: return .blue
        case .done: return .green
        case .error: return .orange
        case .checking, .downloading, .installing: return .secondary
        case .idle: return .secondary
        }
    }
}
