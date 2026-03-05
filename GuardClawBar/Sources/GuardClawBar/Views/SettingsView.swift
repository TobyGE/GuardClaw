import SwiftUI

struct SettingsView: View {
    @State private var serverURL: String = SettingsStore.shared.serverURL
    @State private var pollInterval: Double = SettingsStore.shared.pollInterval
    @State private var models: [BuiltinModel] = []
    @State private var isLoadingModels = true

    private let api = GuardClawAPI()
    private let timer = Timer.publish(every: 1.5, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Settings")
                    .font(.headline)

                // -- Built-in Model --
                VStack(alignment: .leading, spacing: 6) {
                    Text("Built-in Judge Model")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if isLoadingModels && models.isEmpty {
                        HStack {
                            ProgressView().controlSize(.small)
                            Text("Loading...")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                        .frame(height: 50)
                    }

                    ForEach(models) { m in
                        ModelRowView(model: m, api: api, onRefresh: { fetchModels() })
                    }
                }

                Divider()

                // -- Server URL --
                VStack(alignment: .leading, spacing: 4) {
                    Text("Server URL")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField("http://localhost:3002", text: $serverURL)
                        .textFieldStyle(.roundedBorder)
                        .font(.caption)
                        .onSubmit { save() }
                }

                // -- Poll Interval --
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
        }
        .frame(width: 300, height: 340)
        .onAppear { fetchModels() }
        .onReceive(timer) { _ in fetchModels() }
    }

    private func save() {
        SettingsStore.shared.serverURL = serverURL
        SettingsStore.shared.pollInterval = pollInterval
    }

    private func fetchModels() {
        Task {
            do {
                let resp = try await api.listModels()
                await MainActor.run {
                    models = resp.models
                    isLoadingModels = false
                }
            } catch {
                await MainActor.run { isLoadingModels = false }
            }
        }
    }
}

// MARK: - Model Row

private struct ModelRowView: View {
    let model: BuiltinModel
    let api: GuardClawAPI
    let onRefresh: () -> Void

    private var isBusy: Bool { model.downloading || model.loading }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            headerRow
            if isBusy { progressSection }
            errorSection
        }
        .padding(8)
        .background(backgroundFill)
        .overlay(borderOverlay)
    }

    private var headerRow: some View {
        HStack(spacing: 6) {
            Text(model.name)
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(model.loaded ? .green : .primary)

            if model.recommended == true {
                Text("rec")
                    .font(.system(size: 8, weight: .bold))
                    .textCase(.uppercase)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(.orange.opacity(0.2))
                    .foregroundStyle(.orange)
                    .clipShape(Capsule())
            }

            Text(model.size)
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)

            Spacer()

            actionArea
        }
    }

    @ViewBuilder
    private var actionArea: some View {
        if model.loaded {
            loadedActions
        } else if isBusy {
            busyActions
        } else if model.downloaded {
            Button("Run") { setup() }
                .font(.system(size: 9))
                .controlSize(.mini)
        } else {
            Button("Setup & Run") { setup() }
                .font(.system(size: 9))
                .controlSize(.mini)
        }
    }

    private var loadedActions: some View {
        HStack(spacing: 4) {
            Circle().fill(.green).frame(width: 6, height: 6)
            Text("Active")
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(.green)
            Button("Stop") { Task { _ = try? await api.unloadModel(); onRefresh() } }
                .font(.system(size: 9))
                .controlSize(.mini)
        }
    }

    private var busyActions: some View {
        Group {
            if model.downloading {
                Button("Cancel") { Task { _ = try? await api.cancelDownload(id: model.id); onRefresh() } }
                    .font(.system(size: 9))
                    .controlSize(.mini)
            }
        }
    }

    private var progressSection: some View {
        VStack(alignment: .leading, spacing: 3) {
            ProgressView(value: model.downloading ? max(Double(model.progress), 2) / 100.0 : 1.0)
                .tint(.blue)

            Text(model.statusMessage ?? (model.downloading ? "Downloading... \(model.progress)%" : "Loading model..."))
                .font(.system(size: 9))
                .foregroundStyle(.blue)
        }
    }

    @ViewBuilder
    private var errorSection: some View {
        if let error = model.setupError, !isBusy {
            HStack(alignment: .top, spacing: 4) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(.red)
                Text(error)
                    .font(.system(size: 9))
                    .foregroundStyle(.red)
                    .lineLimit(2)
            }
        }
    }

    private var backgroundFill: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(model.loaded ? Color.green.opacity(0.08) :
                  isBusy ? Color.blue.opacity(0.06) :
                  Color.clear)
    }

    private var borderOverlay: some View {
        RoundedRectangle(cornerRadius: 8)
            .stroke(model.loaded ? Color.green.opacity(0.3) :
                    isBusy ? Color.blue.opacity(0.2) :
                    Color.gray.opacity(0.2), lineWidth: 1)
    }

    private func setup() {
        Task { _ = try? await api.setupModel(id: model.id); onRefresh() }
    }
}
