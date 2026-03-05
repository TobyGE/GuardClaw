import SwiftUI
import AppKit

struct FooterView: View {
    @Bindable var appState: AppState
    @State private var showSettings = false

    var body: some View {
        HStack(spacing: 12) {
            Button("Open Dashboard") {
                let url = URL(string: SettingsStore.shared.serverURL)!
                NSWorkspace.shared.open(url)
            }
            .buttonStyle(.plain)
            .font(.caption)
            .foregroundStyle(.blue)

            Spacer()

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
