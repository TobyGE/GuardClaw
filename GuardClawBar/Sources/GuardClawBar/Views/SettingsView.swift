import SwiftUI

struct SettingsView: View {
    @State private var serverURL: String = SettingsStore.shared.serverURL
    @State private var pollInterval: Double = SettingsStore.shared.pollInterval

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Settings")
                .font(.headline)

            VStack(alignment: .leading, spacing: 4) {
                Text("Server URL")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("http://localhost:3002", text: $serverURL)
                    .textFieldStyle(.roundedBorder)
                    .font(.caption)
                    .onSubmit { save() }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Poll Interval: \(String(format: "%.0f", pollInterval))s")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Slider(value: $pollInterval, in: 1...30, step: 1)
                    .onChange(of: pollInterval) { _, _ in save() }
            }

            HStack {
                Spacer()
                Button("Save") { save() }
                    .controlSize(.small)
            }
        }
        .padding(16)
        .frame(width: 280)
    }

    private func save() {
        SettingsStore.shared.serverURL = serverURL
        SettingsStore.shared.pollInterval = pollInterval
    }
}
