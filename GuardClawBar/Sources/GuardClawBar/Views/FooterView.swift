import SwiftUI
import AppKit

struct FooterView: View {
    @Bindable var appState: AppState
    @State private var showSettings = false
    @State private var updateStatus: UpdateStatus = .idle

    enum UpdateStatus: Equatable {
        case idle
        case checking
        case upToDate
        case available(version: String, url: String)
        case error(String)
    }

    var body: some View {
        VStack(spacing: 6) {
            if case .available(let version, _) = updateStatus {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.down.circle.fill")
                        .foregroundStyle(.blue)
                        .font(.caption)
                    Text("\(version) available")
                        .font(.caption2)
                        .fontWeight(.medium)
                    Spacer()
                    Button("Download") {
                        if case .available(_, let url) = updateStatus,
                           let downloadURL = URL(string: url) {
                            NSWorkspace.shared.open(downloadURL)
                        }
                    }
                    .controlSize(.mini)
                }
                .padding(.horizontal, 16)
                .padding(.top, 6)
            }

            HStack(spacing: 12) {
                Button("Open Dashboard") {
                    AppDelegate.shared?.openDashboard()
                }
                .buttonStyle(.plain)
                .font(.caption)
                .foregroundStyle(.blue)

                Spacer()

                Button(action: { checkForUpdates() }) {
                    Image(systemName: updateIcon)
                        .font(.caption)
                        .foregroundStyle(updateColor)
                }
                .buttonStyle(.plain)
                .disabled(updateStatus == .checking)
                .help("Check for updates")

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
    }

    private var updateIcon: String {
        switch updateStatus {
        case .checking: return "arrow.triangle.2.circlepath"
        case .upToDate: return "checkmark.circle"
        case .available: return "arrow.down.circle.fill"
        case .error: return "exclamationmark.triangle"
        case .idle: return "arrow.triangle.2.circlepath"
        }
    }

    private var updateColor: Color {
        switch updateStatus {
        case .upToDate: return .green
        case .available: return .blue
        case .error: return .orange
        default: return .secondary
        }
    }

    private func checkForUpdates() {
        updateStatus = .checking
        Task {
            let result = await UpdateChecker.shared.check()
            await MainActor.run {
                switch result {
                case .upToDate:
                    updateStatus = .upToDate
                case .newVersion(let version, let url):
                    updateStatus = .available(version: version, url: url)
                case .error(let msg):
                    updateStatus = .error(msg)
                }
            }
        }
    }
}
