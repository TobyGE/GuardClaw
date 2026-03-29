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
    @State private var cloudJudgeConfig: CloudJudgeConfig? = nil
    private var L: Loc { Loc.shared }

    private let api = GuardClawAPI()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Current status card
                currentStatusCard

                Divider()

                // Backend picker
                VStack(alignment: .leading, spacing: 8) {
                    Text(L.t("judge.switchBackend"))
                        .font(.headline)

                    Picker(L.t("judge.backend"), selection: Binding(
                        get: { pendingBackend ?? llmBackend },
                        set: { newVal in
                            pendingBackend = newVal
                            switchBackend(to: newVal)
                        }
                    )) {
                        Text(L.t("judge.builtInMLX")).tag("built-in")
                        Text("LM Studio").tag("lmstudio")
                        Text("Ollama").tag("ollama")
                        Text(L.t("judge.anthropicClaude")).tag("anthropic")
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
                        .foregroundStyle(msg.contains("\u{2713}") ? .green : .orange)
                }

                Divider()

                // Cloud Judge Section
                CloudJudgeDashboardSection(config: $cloudJudgeConfig, api: api)
            }
            .padding(24)
        }
        .navigationTitle(L.t("judge.title"))
        .task {
            loadStatus()
            await fetchCloudJudgeConfig()
            if llmBackend == "lmstudio" || llmBackend == "ollama" {
                await fetchExternalModels()
            }
        }
        .onChange(of: appState.serverStatus?.llmStatus?.connected) { _, _ in
            loadStatusFromAppState()
        }
    }

    // MARK: - Current Status

    private var currentStatusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Circle()
                    .fill(llmConnected == true ? Color.green : Color.orange)
                    .frame(width: 10, height: 10)
                Text(llmConnected == true ? L.t("judge.online") : L.t("judge.offline"))
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Spacer()
            }

            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L.t("judge.backend"))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Text(backendDisplayName(llmBackend))
                        .font(.caption)
                        .fontWeight(.medium)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(L.t("judge.model"))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Text(activeModel ?? L.t("judge.none"))
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
        case "built-in": return L.t("judge.builtInMLX")
        case "lmstudio": return "LM Studio"
        case "ollama": return "Ollama"
        case "anthropic": return L.t("judge.anthropicClaude")
        default: return backend
        }
    }

    // MARK: - Built-in Section

    private var builtInSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L.t("judge.builtInModels"))
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if isLoadingModels {
                HStack { ProgressView().controlSize(.small); Text(L.t("common.loading")).font(.caption) }
            }

            ForEach(models) { model in
                ModelRowView(model: model, api: api, onRefresh: loadStatus)
            }

            if !isLoadingModels && models.isEmpty {
                Text(L.t("judge.noModels"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - External Backend Section

    private var externalBackendLabel: String {
        let displayBackend = pendingBackend ?? llmBackend
        switch displayBackend {
        case "lmstudio": return L.t("judge.lmStudioAt")
        case "ollama": return L.t("judge.ollamaAt")
        case "anthropic": return L.t("judge.anthropicKey")
        default: return ""
        }
    }

    private var externalBackendSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(externalBackendLabel)
                .font(.caption)
                .foregroundStyle(.secondary)

            if isLoadingExternalModels {
                HStack { ProgressView().controlSize(.small); Text(L.t("judge.fetchingModels")).font(.caption) }
            } else if !externalModels.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(L.t("judge.availableModels"))
                        .font(.subheadline)
                        .fontWeight(.medium)
                    Picker(L.t("judge.model"), selection: $selectedExternalModel) {
                        Text(L.t("benchmark.auto")).tag("")
                        ForEach(externalModels, id: \.self) { model in
                            Text(model).tag(model)
                        }
                    }
                    .labelsHidden()

                    Button(L.t("common.apply")) {
                        Task { await applyExternalModel() }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(selectedExternalModel.isEmpty)
                }
            } else {
                HStack(spacing: 8) {
                    Button(L.t("judge.fetchModels")) {
                        Task { await fetchExternalModels() }
                    }
                    .controlSize(.small)

                    Button(L.t("judge.testConnection")) {
                        Task {
                            let result = try? await api.switchLLMBackend(backend: pendingBackend ?? llmBackend)
                            statusMessage = result?.success == true ? "\u{2713} " + L.t("judge.testConnected") : L.t("judge.testFailed")
                        }
                    }
                    .controlSize(.small)
                }
            }
        }
    }

    // MARK: - Actions

    /// Read LLM status from AppState (no API call)
    private func loadStatusFromAppState() {
        let status = appState.serverStatus
        llmConnected = status?.llmStatus?.connected
        let serverBackend = status?.llmStatus?.backend ?? "built-in"
        if pendingBackend == nil {
            llmBackend = serverBackend
        } else if pendingBackend == serverBackend {
            pendingBackend = nil
            llmBackend = serverBackend
        }
        // External model name
        if activeModel == nil && llmBackend != "built-in" && llmConnected == true {
            activeModel = llmBackend == "lmstudio" ? "LM Studio model" : llmBackend == "ollama" ? "Ollama model" : "Claude"
        }
    }

    /// Initial load: read AppState + fetch model list once
    private func loadStatus() {
        loadStatusFromAppState()
        Task {
            if let resp = try? await api.listModels() {
                models = resp.models
                isLoadingModels = false
                activeModel = resp.models.first(where: { $0.loaded })?.name
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
            statusMessage = L.t("settings.failed", error.localizedDescription)
        }
    }

    private func fetchCloudJudgeConfig() async {
        if let cfg = try? await api.cloudJudgeConfig() {
            await MainActor.run { cloudJudgeConfig = cfg }
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
            statusMessage = resp.success == true ? "\u{2713} Model set to \(selectedExternalModel)" : (resp.message ?? "Failed")
            activeModel = selectedExternalModel
            loadStatus()
        } catch {
            statusMessage = L.t("settings.failed", error.localizedDescription)
        }
    }
}

// MARK: - Cloud Judge Dashboard Section

private struct CloudJudgeDashboardSection: View {
    @Binding var config: CloudJudgeConfig?
    let api: GuardClawAPI
    @State private var connecting: String? = nil
    @State private var apiKey: String = ""
    @State private var message: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Cloud Judge")
                    .font(.headline)
                Spacer()
                Toggle("", isOn: Binding(
                    get: { config?.enabled ?? false },
                    set: { val in
                        Task {
                            _ = try? await api.updateCloudJudge(enabled: val)
                            await refreshConfig()
                        }
                    }
                ))
                .toggleStyle(.switch)
                .controlSize(.small)
            }

            Text("When local model returns WARNING or BLOCK, re-analyze with a cloud LLM. PII is masked before sending.")
                .font(.caption)
                .foregroundStyle(.secondary)

            // Provider list
            VStack(spacing: 8) {
                ForEach(config?.providers ?? [], id: \.id) { provider in
                    HStack(spacing: 10) {
                        Circle()
                            .fill(provider.connected ? Color.green : Color.gray.opacity(0.4))
                            .frame(width: 8, height: 8)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(provider.displayName)
                                .font(.subheadline)
                            if provider.oauthSupported != true {
                                Text("API key required")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        Spacer()
                        if provider.oauthSupported == true {
                            if provider.connected {
                                HStack(spacing: 6) {
                                    Text("Connected")
                                        .font(.caption)
                                        .foregroundStyle(.green)
                                    Button("Disconnect") {
                                        Task {
                                            try? await api.cloudJudgeOAuthDisconnect(provider: provider.id)
                                            await refreshConfig()
                                        }
                                    }
                                    .controlSize(.small)
                                    .foregroundStyle(.red)
                                }
                            } else {
                                Button(connecting == provider.id ? "Waiting for browser…" : "Sign in with Claude") {
                                    guard connecting == nil else { return }
                                    connecting = provider.id
                                    Task {
                                        do {
                                            _ = try await api.cloudJudgeOAuthConnect(provider: provider.id)
                                            await refreshConfig()
                                            await MainActor.run { message = "✓ \(provider.displayName) connected" }
                                        } catch {
                                            await MainActor.run { message = error.localizedDescription }
                                        }
                                        await MainActor.run { connecting = nil }
                                    }
                                }
                                .buttonStyle(.borderedProminent)
                                .controlSize(.small)
                                .disabled(connecting != nil)
                            }
                        }
                    }
                    .padding(12)
                    .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(provider.connected ? Color.green.opacity(0.3) : Color.gray.opacity(0.15), lineWidth: 1)
                    )
                }
            }

            // API key for Gemini / OpenAI
            VStack(alignment: .leading, spacing: 6) {
                Text("API Key (Gemini / OpenAI)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    SecureField("Paste API key…", text: $apiKey)
                        .textFieldStyle(.roundedBorder)
                    Button("Save") {
                        Task {
                            _ = try? await api.updateCloudJudge(enabled: true, apiKey: apiKey)
                            await refreshConfig()
                            await MainActor.run { message = "✓ API key saved" }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(apiKey.isEmpty)
                }
            }

            if let msg = message {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(msg.hasPrefix("✓") ? .green : .red)
            }
        }
        .onAppear { Task { await refreshConfig() } }
    }

    private func refreshConfig() async {
        if let cfg = try? await api.cloudJudgeConfig() {
            await MainActor.run { config = cfg }
        }
    }
}

// MARK: - Reused ModelRowView

private struct ModelRowView: View {
    let model: BuiltinModel
    let api: GuardClawAPI
    let onRefresh: () -> Void
    private var L: Loc { Loc.shared }

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
                            Text(L.t("judge.recommended"))
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
                Text(model.statusMessage ?? (model.downloading ? L.t("settings.downloading", model.progress) : L.t("settings.loadingModel")))
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
                Text(L.t("common.active")).font(.caption2).foregroundStyle(.green)
                Button(L.t("common.stop")) {
                    Task { _ = try? await api.unloadModel(); onRefresh() }
                }.controlSize(.small)
            }
        } else if isBusy {
            if model.downloading {
                Button(L.t("common.cancel")) {
                    Task { _ = try? await api.cancelDownload(id: model.id); onRefresh() }
                }.controlSize(.small)
            }
        } else if model.downloaded {
            Button(L.t("common.run")) {
                Task { _ = try? await api.setupModel(id: model.id); onRefresh() }
            }.controlSize(.small)
        } else {
            Button(L.t("settings.setupRun")) {
                Task { _ = try? await api.setupModel(id: model.id); onRefresh() }
            }.controlSize(.small)
        }
    }
}
