import SwiftUI

struct JudgeSettingsView: View {
    @Environment(AppState.self) var appState
    @State private var models: [BuiltinModel] = []
    @State private var isLoadingModels = true
    @State private var llmBackend: String = "built-in"
    @State private var pendingBackend: String? = nil // prevent polling overwrite
    @State private var llmConnected: Bool? = nil
    @State private var activeModel: String? = nil
    @State private var statusMessage: String? = nil
    @State private var externalModels: [String] = []
    @State private var selectedExternalModel: String = ""
    @State private var isLoadingExternalModels = false

    private let api = GuardClawAPI()
    private let timer = Timer.publish(every: 3, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Current status card
                currentStatusCard

                Divider()

                // Backend picker
                VStack(alignment: .leading, spacing: 8) {
                    Text("Switch Backend")
                        .font(.headline)

                    Picker("Backend", selection: Binding(
                        get: { pendingBackend ?? llmBackend },
                        set: { newVal in
                            pendingBackend = newVal
                            switchBackend(to: newVal)
                        }
                    )) {
                        Text("Built-in (MLX)").tag("built-in")
                        Text("LM Studio").tag("lmstudio")
                        Text("Ollama").tag("ollama")
                        Text("Anthropic Claude").tag("anthropic")
                    }
                    .pickerStyle(.segmented)
                    .disabled(pendingBackend != nil)
                }

                // Backend-specific content
                let displayBackend = pendingBackend ?? llmBackend
                if displayBackend == "built-in" || displayBackend.isEmpty {
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
        .onAppear {
            loadStatus()
            if llmBackend == "lmstudio" || llmBackend == "ollama" {
                Task { await fetchExternalModels() }
            }
        }
        .onReceive(timer) { _ in loadStatus() }
    }

    // MARK: - Current Status

    private var currentStatusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Circle()
                    .fill(llmConnected == true ? Color.green : Color.orange)
                    .frame(width: 10, height: 10)
                Text(llmConnected == true ? "Judge Online" : "Judge Offline")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Spacer()
            }

            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Backend")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Text(backendDisplayName(llmBackend))
                        .font(.caption)
                        .fontWeight(.medium)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Model")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Text(activeModel ?? "None")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(activeModel != nil ? .primary : .secondary)
                }
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke((llmConnected == true ? Color.green : Color.orange).opacity(0.3), lineWidth: 1)
        )
    }

    private func backendDisplayName(_ backend: String) -> String {
        switch backend {
        case "built-in": return "Built-in (MLX)"
        case "lmstudio": return "LM Studio"
        case "ollama": return "Ollama"
        case "anthropic": return "Anthropic Claude"
        default: return backend
        }
    }

    // MARK: - Built-in Section

    private var builtInSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Built-in Models")
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
        let displayBackend = pendingBackend ?? llmBackend
        switch displayBackend {
        case "lmstudio": return "LM Studio at http://localhost:1234"
        case "ollama": return "Ollama at http://localhost:11434"
        case "anthropic": return "Uses ANTHROPIC_API_KEY from environment"
        default: return ""
        }
    }

    private var externalBackendSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(externalBackendLabel)
                .font(.caption)
                .foregroundStyle(.secondary)

            if isLoadingExternalModels {
                HStack { ProgressView().controlSize(.small); Text("Fetching models...").font(.caption) }
            } else if !externalModels.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Available Models")
                        .font(.subheadline)
                        .fontWeight(.medium)
                    Picker("Model", selection: $selectedExternalModel) {
                        Text("Auto").tag("")
                        ForEach(externalModels, id: \.self) { model in
                            Text(model).tag(model)
                        }
                    }
                    .labelsHidden()

                    Button("Apply") {
                        Task { await applyExternalModel() }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(selectedExternalModel.isEmpty)
                }
            } else {
                HStack(spacing: 8) {
                    Button("Fetch Models") {
                        Task { await fetchExternalModels() }
                    }
                    .controlSize(.small)

                    Button("Test Connection") {
                        Task {
                            let result = try? await api.switchLLMBackend(backend: pendingBackend ?? llmBackend)
                            statusMessage = result?.success == true ? "✓ Connected" : "Connection failed"
                        }
                    }
                    .controlSize(.small)
                }
            }
        }
    }

    // MARK: - Actions

    private func loadStatus() {
        Task {
            if let status = try? await api.status() {
                llmConnected = status.llmStatus?.connected
                let serverBackend = status.llmStatus?.backend ?? "built-in"
                // Only update if no pending switch
                if pendingBackend == nil {
                    llmBackend = serverBackend
                } else if pendingBackend == serverBackend {
                    // Server caught up, clear pending
                    pendingBackend = nil
                    llmBackend = serverBackend
                }
            }
            if let resp = try? await api.listModels() {
                models = resp.models
                isLoadingModels = false
                activeModel = resp.models.first(where: { $0.loaded })?.name
            }
            // If no built-in model active and using external, get model name from status
            if activeModel == nil, let status = try? await api.status() {
                // External backends don't report model through listModels
                if llmBackend != "built-in" && llmConnected == true {
                    activeModel = llmBackend == "lmstudio" ? "LM Studio model" : llmBackend == "ollama" ? "Ollama model" : "Claude"
                }
            }
        }
    }

    private func switchBackend(to backend: String) {
        externalModels = []
        selectedExternalModel = ""
        statusMessage = nil
        Task {
            _ = try? await api.switchLLMBackend(backend: backend)
            // Update display immediately but keep pendingBackend so polling doesn't overwrite
            llmBackend = backend
            loadStatus()
            if backend == "lmstudio" || backend == "ollama" {
                await fetchExternalModels()
            }
            // Clear pendingBackend after delay so server has time to catch up
            try? await Task.sleep(for: .seconds(5))
            if pendingBackend == backend {
                pendingBackend = nil
            }
        }
    }

    private func fetchExternalModels() async {
        isLoadingExternalModels = true
        defer { isLoadingExternalModels = false }
        let backend = pendingBackend ?? llmBackend
        do {
            let resp = try await api.fetchExternalModels(backend: backend)
            externalModels = resp.models ?? []
            if externalModels.isEmpty {
                statusMessage = resp.error ?? "No models found — is \(backend) running?"
            }
        } catch {
            statusMessage = "Failed to fetch models: \(error.localizedDescription)"
        }
    }

    private func applyExternalModel() async {
        let backend = pendingBackend ?? llmBackend
        do {
            let resp: LLMConfigResponse
            if backend == "lmstudio" {
                resp = try await api.configLLM(backend: backend, lmstudioModel: selectedExternalModel)
            } else {
                resp = try await api.configLLM(backend: backend, ollamaModel: selectedExternalModel)
            }
            statusMessage = resp.success == true ? "✓ Model set to \(selectedExternalModel)" : (resp.message ?? "Failed")
            activeModel = selectedExternalModel
            loadStatus()
        } catch {
            statusMessage = "Failed: \(error.localizedDescription)"
        }
    }
}

// MARK: - Reused ModelRowView

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
