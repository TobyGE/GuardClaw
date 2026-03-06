import SwiftUI

struct JudgeSettingsView: View {
    @Environment(AppState.self) var appState
    @State private var models: [BuiltinModel] = []
    @State private var isLoadingModels = true
    @State private var llmBackend: String = "built-in"
    @State private var isChangingBackend = false
    @State private var llmConnected: Bool? = nil
    @State private var statusMessage: String? = nil

    private let api = GuardClawAPI()
    private let timer = Timer.publish(every: 3, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Status header
                HStack(spacing: 8) {
                    Circle()
                        .fill(llmConnected == true ? Color.green : Color.orange)
                        .frame(width: 10, height: 10)
                    Text(llmConnected == true ? "Judge is ready" : "Judge not connected")
                        .font(.subheadline)
                        .fontWeight(.medium)
                    Spacer()
                }

                // Backend picker
                VStack(alignment: .leading, spacing: 8) {
                    Text("Safety Judge")
                        .font(.headline)

                    Picker("Backend", selection: Binding(
                        get: { llmBackend },
                        set: { newVal in
                            llmBackend = newVal
                            switchBackend(to: newVal)
                        }
                    )) {
                        Text("Built-in (Apple Silicon)").tag("built-in")
                        Text("LM Studio").tag("lmstudio")
                        Text("Ollama").tag("ollama")
                        Text("Anthropic Claude").tag("anthropic")
                    }
                    .pickerStyle(.segmented)
                    .disabled(isChangingBackend)
                }

                Divider()

                // Backend-specific content
                if llmBackend == "built-in" || llmBackend.isEmpty {
                    builtInSection
                } else {
                    externalBackendSection
                }

                if let msg = statusMessage {
                    Text(msg)
                        .font(.caption)
                        .foregroundStyle(msg.contains("✓") ? .green : .orange)
                }
            }
            .padding(24)
        }
        .navigationTitle("Judge")
        .onAppear { loadStatus() }
        .onReceive(timer) { _ in loadStatus() }
    }

    // MARK: - Built-in Section

    private var builtInSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Models")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if isLoadingModels {
                HStack { ProgressView().controlSize(.small); Text("Loading...").font(.caption) }
            }

            ForEach(models) { model in
                ModelRowView(model: model, api: api, onRefresh: loadStatus)
            }

            if !isLoadingModels && models.isEmpty {
                Text("No built-in models available")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - External Backend Section

    private var externalBackendLabel: String {
        switch llmBackend {
        case "lmstudio": return "LM Studio running at http://localhost:1234"
        case "ollama": return "Ollama running at http://localhost:11434"
        case "anthropic": return "Uses ANTHROPIC_API_KEY from environment"
        default: return ""
        }
    }

    private var externalBackendSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(externalBackendLabel)
                .font(.caption)
                .foregroundStyle(.secondary)

            Button("Test Connection") {
                Task {
                    let result = try? await api.switchLLMBackend(backend: llmBackend)
                    statusMessage = result?.success == true ? "✓ Connected" : "Connection failed"
                }
            }
            .controlSize(.small)
        }
    }

    // MARK: - Actions

    private func loadStatus() {
        Task {
            if let status = try? await api.status() {
                llmConnected = status.llmStatus?.connected
                if !isChangingBackend {
                    llmBackend = status.llmStatus?.backend ?? "built-in"
                }
            }
            if let resp = try? await api.listModels() {
                models = resp.models
                isLoadingModels = false
            }
        }
    }

    private func switchBackend(to backend: String) {
        isChangingBackend = true
        Task {
            _ = try? await api.switchLLMBackend(backend: backend)
            isChangingBackend = false
            loadStatus()
        }
    }
}

// MARK: - Reused ModelRowView (imported from SettingsView)

private struct ModelRowView: View {
    let model: BuiltinModel
    let api: GuardClawAPI
    let onRefresh: () -> Void

    private var isBusy: Bool { model.downloading || model.loading }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(model.name)
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundStyle(model.loaded ? .green : .primary)
                        if model.recommended == true {
                            Text("RECOMMENDED")
                                .font(.system(size: 8, weight: .bold))
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1)
                                .background(.orange.opacity(0.2))
                                .foregroundStyle(.orange)
                                .clipShape(Capsule())
                        }
                    }
                    Text(model.size)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                Spacer()
                actionArea
            }

            if isBusy {
                ProgressView(value: model.downloading ? max(Double(model.progress), 2) / 100.0 : 1.0)
                    .tint(.blue)
                Text(model.statusMessage ?? (model.downloading ? "Downloading... \(model.progress)%" : "Loading..."))
                    .font(.caption2)
                    .foregroundStyle(.blue)
            }

            if let err = model.setupError, !isBusy {
                Label(err, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption2)
                    .foregroundStyle(.red)
            }
        }
        .padding(12)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(model.loaded ? Color.green.opacity(0.4) : isBusy ? Color.blue.opacity(0.3) : Color.gray.opacity(0.2), lineWidth: 1)
        )
    }

    @ViewBuilder
    private var actionArea: some View {
        if model.loaded {
            HStack(spacing: 6) {
                Circle().fill(.green).frame(width: 6, height: 6)
                Text("Active").font(.caption2).foregroundStyle(.green)
                Button("Stop") {
                    Task { _ = try? await api.unloadModel(); onRefresh() }
                }.controlSize(.small)
            }
        } else if isBusy {
            if model.downloading {
                Button("Cancel") {
                    Task { _ = try? await api.cancelDownload(id: model.id); onRefresh() }
                }.controlSize(.small)
            }
        } else if model.downloaded {
            Button("Run") {
                Task { _ = try? await api.setupModel(id: model.id); onRefresh() }
            }.controlSize(.small)
        } else {
            Button("Setup & Run") {
                Task { _ = try? await api.setupModel(id: model.id); onRefresh() }
            }.controlSize(.small)
        }
    }
}
