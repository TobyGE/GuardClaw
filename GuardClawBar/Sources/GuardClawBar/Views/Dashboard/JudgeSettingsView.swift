import SwiftUI

struct JudgeSettingsView: View {
    @Environment(AppState.self) var appState
    @State private var selectedTab: JudgeTab = .local
    @State private var cloudJudgeConfig: CloudJudgeConfig? = nil
    private var L: Loc { Loc.shared }
    private let api = GuardClawAPI()

    enum JudgeTab: String, CaseIterable {
        case local = "Local"
        case cloud = "Cloud"
        case mode = "Judge Mode"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Picker("", selection: $selectedTab) {
                    ForEach(JudgeTab.allCases, id: \.self) { tab in
                        Text(tab.rawValue).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()

                switch selectedTab {
                case .local:
                    LocalJudgeSection(api: api, appState: appState)
                case .cloud:
                    CloudProvidersSection(config: $cloudJudgeConfig, api: api)
                case .mode:
                    JudgeModeSection(
                        config: $cloudJudgeConfig,
                        api: api,
                        localModelReady: appState.serverStatus?.llmStatus?.connected == true
                    )
                }
            }
            .padding(24)
        }
        .navigationTitle(L.t("judge.title"))
        .task { await fetchCloudJudgeConfig() }
        .onChange(of: selectedTab) { _, _ in
            Task { await fetchCloudJudgeConfig() }
        }
    }

    private func fetchCloudJudgeConfig() async {
        if let cfg = try? await api.cloudJudgeConfig() {
            await MainActor.run { cloudJudgeConfig = cfg }
        }
    }
}

// MARK: - Local Tab

private struct LocalJudgeSection: View {
    let api: GuardClawAPI
    let appState: AppState
    @State private var models: [BuiltinModel] = []
    @State private var isLoadingModels = true
    @State private var llmBackend: String = "built-in"
    @State private var isSwitching: Bool = false  // prevents polling overwrite during switch
    @State private var llmConnected: Bool? = nil
    @State private var activeModel: String? = nil
    @State private var statusMessage: String? = nil
    @State private var externalModels: [String] = []
    @State private var selectedExternalModel: String = ""
    @State private var isLoadingExternalModels = false
    private var L: Loc { Loc.shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            statusCard

            VStack(alignment: .leading, spacing: 8) {
                Text(L.t("judge.switchBackend")).font(.headline)
                Picker(L.t("judge.backend"), selection: Binding(
                    get: { llmBackend },
                    set: { newVal in switchBackend(to: newVal) }
                )) {
                    Text(L.t("judge.builtInMLX")).tag("built-in")
                    Text("LM Studio").tag("lmstudio")
                    Text("Ollama").tag("ollama")
                }
                .pickerStyle(.segmented)
                .disabled(isSwitching)
            }

            let displayBackend = llmBackend
            if displayBackend == "built-in" || displayBackend.isEmpty {
                builtInSection
            } else {
                externalBackendSection
            }

            if let msg = statusMessage {
                Text(msg).font(.caption)
                    .foregroundStyle(msg.contains("✓") ? .green : .orange)
            }
        }
        .task {
            loadStatus()
            if llmBackend == "lmstudio" || llmBackend == "ollama" {
                await fetchExternalModels()
            }
        }
        .onChange(of: appState.serverStatus?.llmStatus?.connected) { _, _ in
            loadStatusFromAppState()
        }
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Circle().fill(llmConnected == true ? Color.green : Color.orange)
                    .frame(width: 10, height: 10)
                Text(llmConnected == true ? L.t("judge.online") : L.t("judge.offline"))
                    .font(.subheadline).fontWeight(.semibold)
                Spacer()
            }
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L.t("judge.backend")).font(.caption2).foregroundStyle(.tertiary)
                    Text(backendDisplayName(llmBackend)).font(.caption).fontWeight(.medium)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(L.t("judge.model")).font(.caption2).foregroundStyle(.tertiary)
                    Text(activeModel ?? L.t("judge.none")).font(.caption).fontWeight(.medium)
                        .foregroundStyle(activeModel != nil ? .primary : .secondary)
                }
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12)
            .stroke((llmConnected == true ? Color.green : Color.orange).opacity(0.3), lineWidth: 1))
    }

    private func backendDisplayName(_ backend: String) -> String {
        switch backend {
        case "built-in": return L.t("judge.builtInMLX")
        case "lmstudio": return "LM Studio"
        case "ollama": return "Ollama"
        default: return backend
        }
    }

    private var builtInSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L.t("judge.builtInModels")).font(.subheadline).foregroundStyle(.secondary)
            if isLoadingModels {
                HStack { ProgressView().controlSize(.small); Text(L.t("common.loading")).font(.caption) }
            }
            ForEach(models) { model in
                ModelRowView(model: model, api: api, onRefresh: loadStatus)
            }
            if !isLoadingModels && models.isEmpty {
                Text(L.t("judge.noModels")).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var externalBackendSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            let backend = llmBackend
            Text(backend == "lmstudio" ? L.t("judge.lmStudioAt") : L.t("judge.ollamaAt"))
                .font(.caption).foregroundStyle(.secondary)

            if isLoadingExternalModels {
                HStack { ProgressView().controlSize(.small); Text(L.t("judge.fetchingModels")).font(.caption) }
            } else if !externalModels.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(L.t("judge.availableModels")).font(.subheadline).fontWeight(.medium)
                    Picker(L.t("judge.model"), selection: $selectedExternalModel) {
                        Text(L.t("benchmark.auto")).tag("")
                        ForEach(externalModels, id: \.self) { Text($0).tag($0) }
                    }
                    .labelsHidden()
                    Button(L.t("common.apply")) { Task { await applyExternalModel() } }
                        .buttonStyle(.borderedProminent).controlSize(.small)
                        .disabled(selectedExternalModel.isEmpty)
                }
            } else {
                HStack(spacing: 8) {
                    Button(L.t("judge.fetchModels")) { Task { await fetchExternalModels() } }.controlSize(.small)
                    Button(L.t("judge.testConnection")) {
                        Task {
                            let result = try? await api.switchLLMBackend(backend: llmBackend)
                            statusMessage = result?.success == true ? "✓ " + L.t("judge.testConnected") : L.t("judge.testFailed")
                        }
                    }
                    .controlSize(.small)
                }
            }
        }
    }

    private func loadStatusFromAppState() {
        let status = appState.serverStatus
        llmConnected = status?.llmStatus?.connected
        guard !isSwitching else { return }  // don't overwrite while we're switching
        let serverBackend = status?.llmStatus?.backend ?? "built-in"
        llmBackend = serverBackend
        if activeModel == nil && llmBackend != "built-in" && llmConnected == true {
            activeModel = llmBackend == "lmstudio" ? "LM Studio model" : "Ollama model"
        }
    }

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
        externalModels = []; selectedExternalModel = ""; statusMessage = nil
        llmBackend = backend  // update immediately so picker reflects selection
        isSwitching = true    // guard against appState overwrite until confirmed
        Task {
            _ = try? await api.switchLLMBackend(backend: backend)
            // Reload models while still blocking appState overwrite
            if let resp = try? await api.listModels() {
                await MainActor.run {
                    models = resp.models
                    isLoadingModels = false
                    activeModel = resp.models.first(where: { $0.loaded })?.name
                }
            }
            if backend == "lmstudio" || backend == "ollama" { await fetchExternalModels() }
            // Give appState one polling cycle to sync, then hand control back
            try? await Task.sleep(for: .milliseconds(800))
            await MainActor.run { isSwitching = false }
        }
    }

    private func fetchExternalModels() async {
        isLoadingExternalModels = true; defer { isLoadingExternalModels = false }
        let backend = llmBackend
        do {
            let resp = try await api.fetchExternalModels(backend: backend)
            externalModels = resp.models ?? []
            if externalModels.isEmpty { statusMessage = resp.error ?? "No models found — is \(backend) running?" }
        } catch { statusMessage = L.t("settings.failed", error.localizedDescription) }
    }

    private func applyExternalModel() async {
        let backend = llmBackend
        do {
            let resp: LLMConfigResponse = backend == "lmstudio"
                ? try await api.configLLM(backend: backend, lmstudioModel: selectedExternalModel)
                : try await api.configLLM(backend: backend, ollamaModel: selectedExternalModel)
            statusMessage = resp.success == true ? "✓ Model set to \(selectedExternalModel)" : (resp.message ?? "Failed")
            activeModel = selectedExternalModel; loadStatus()
        } catch { statusMessage = L.t("settings.failed", error.localizedDescription) }
    }
}

// MARK: - Cloud Tab

private struct ClaudeModel: Identifiable {
    let id: String
    let label: String
}

private let CLAUDE_MODELS: [ClaudeModel] = [
    ClaudeModel(id: "claude-haiku-4-5-20251001", label: "Haiku 4.5  —  Fast & cheap"),
    ClaudeModel(id: "claude-sonnet-4-6",         label: "Sonnet 4.6  —  Balanced"),
    ClaudeModel(id: "claude-opus-4-6",            label: "Opus 4.6  —  Most capable"),
]

private struct CloudProvidersSection: View {
    @Binding var config: CloudJudgeConfig?
    let api: GuardClawAPI
    @State private var connecting: String? = nil
    @State private var apiKey: String = ""
    @State private var message: String? = nil
    @State private var selectedModel: String = "claude-haiku-4-5-20251001"

    private var claudeConnected: Bool {
        config?.providers?.first(where: { $0.id == "claude" })?.connected == true
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Connect cloud providers to use them as judges. You can connect multiple.")
                .font(.caption).foregroundStyle(.secondary)

            VStack(spacing: 8) {
                ForEach(config?.providers ?? [], id: \.id) { provider in
                    providerRow(provider)
                }
            }

            // Claude model picker — only when connected
            if claudeConnected {
                Divider()
                VStack(alignment: .leading, spacing: 6) {
                    Text("Claude Model")
                        .font(.caption).foregroundStyle(.secondary)
                    Picker("", selection: $selectedModel) {
                        ForEach(CLAUDE_MODELS) { m in
                            Text(m.label).tag(m.id)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                    .onChange(of: selectedModel) { _, newModel in
                        Task {
                            _ = try? await api.updateCloudJudge(model: newModel)
                            await refreshConfig()
                        }
                    }
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("API Key (Gemini / OpenAI)")
                    .font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    SecureField("Paste API key…", text: $apiKey)
                        .textFieldStyle(.roundedBorder)
                    Button("Save") {
                        Task {
                            _ = try? await api.updateCloudJudge(apiKey: apiKey)
                            await refreshConfig()
                            await MainActor.run { message = "✓ API key saved" }
                        }
                    }
                    .buttonStyle(.borderedProminent).controlSize(.small)
                    .disabled(apiKey.isEmpty)
                }
            }

            if let msg = message {
                Text(msg).font(.caption)
                    .foregroundStyle(msg.hasPrefix("✓") ? .green : .red)
            }
        }
        .onAppear { Task { await refreshConfig() } }
    }

    @ViewBuilder
    private func providerRow(_ provider: CloudJudgeProviderInfo) -> some View {
        HStack(spacing: 10) {
            Circle()
                .fill(provider.connected ? Color.green : Color.gray.opacity(0.4))
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(provider.displayName).font(.subheadline)
                Text(provider.connected ? "Connected" : (provider.oauthSupported == true ? "Not connected" : "API key required"))
                    .font(.caption2).foregroundStyle(.tertiary)
            }
            Spacer()
            if provider.oauthSupported == true {
                if provider.connected {
                    Button("Disconnect") {
                        Task {
                            try? await api.cloudJudgeOAuthDisconnect(provider: provider.id)
                            await refreshConfig()
                        }
                    }
                    .controlSize(.small).foregroundStyle(.red)
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
                    .buttonStyle(.borderedProminent).controlSize(.small)
                    .disabled(connecting != nil)
                }
            }
        }
        .padding(12)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10)
            .stroke(provider.connected ? Color.green.opacity(0.3) : Color.gray.opacity(0.15), lineWidth: 1))
    }

    private func refreshConfig() async {
        if let cfg = try? await api.cloudJudgeConfig() {
            await MainActor.run {
                config = cfg
                // Sync picker to persisted model, defaulting to haiku if unknown
                if CLAUDE_MODELS.contains(where: { $0.id == cfg.model }) {
                    selectedModel = cfg.model
                }
            }
        }
    }
}

// MARK: - Judge Mode Tab

private struct JudgeModeSection: View {
    @Binding var config: CloudJudgeConfig?
    let api: GuardClawAPI
    let localModelReady: Bool
    @State private var message: String? = nil

    private var currentMode: String { config?.judgeMode ?? "mixed" }
    private var hasCloudProvider: Bool {
        (config?.providers ?? []).contains { $0.connected }
    }
    private var modeWarnings: [String] {
        var warnings: [String] = []
        switch currentMode {
        case "local-only":
            if !localModelReady {
                warnings.append("No local model is loaded. Go to the Local tab to load one — otherwise requests fall back to rule-based scoring.")
            }
        case "mixed":
            if !localModelReady {
                warnings.append("No local model is loaded. The first stage of Mix mode will fall back to rule-based scoring.")
            }
            if !hasCloudProvider {
                warnings.append("No cloud provider connected. Mix mode won't escalate to a second opinion — go to the Cloud tab to connect one.")
            }
        case "cloud-only":
            if !hasCloudProvider {
                warnings.append("No cloud provider connected. All External mode cannot judge any requests — go to the Cloud tab to connect one.")
            }
        default: break
        }
        return warnings
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Enable toggle
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Cloud Judge").font(.headline)
                    Text("Use a cloud LLM as part of your judgment pipeline.")
                        .font(.caption).foregroundStyle(.secondary)
                }
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
                .toggleStyle(.switch).controlSize(.small)
            }

            Divider()

            // Mode-specific warnings
            ForEach(modeWarnings, id: \.self) { warning in
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    Text(warning).font(.caption).foregroundStyle(.secondary)
                }
                .padding(12)
                .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.orange.opacity(0.2), lineWidth: 1))
            }

            // Mode cards
            VStack(spacing: 8) {
                ModeCard(
                    mode: "local-only",
                    title: "All Local",
                    description: "Only your local model judges every action. Fast, private, no API costs.",
                    icon: "cpu",
                    currentMode: currentMode,
                    disabled: false,
                    onSelect: { setMode("local-only") }
                )
                ModeCard(
                    mode: "mixed",
                    title: "Hybrid",
                    description: "Local model runs first. If score ≥ 4 (WARNING/BLOCK), a cloud model re-analyzes for a second opinion. Recommended.",
                    icon: "arrow.triangle.branch",
                    currentMode: currentMode,
                    disabled: !hasCloudProvider,
                    onSelect: { setMode("mixed") }
                )
                ModeCard(
                    mode: "cloud-only",
                    title: "All External",
                    description: "Every action goes directly to your cloud provider. Highest accuracy, but uses API credits for every tool call.",
                    icon: "cloud",
                    currentMode: currentMode,
                    disabled: !hasCloudProvider,
                    onSelect: { setMode("cloud-only") }
                )
            }

            if let msg = message {
                Text(msg).font(.caption)
                    .foregroundStyle(msg.hasPrefix("✓") ? .green : .red)
            }
        }
        .onAppear { Task { await refreshConfig() } }
    }

    private func setMode(_ mode: String) {
        Task {
            _ = try? await api.updateCloudJudge(judgeMode: mode)
            await refreshConfig()
            await MainActor.run { message = "✓ Mode set to \(mode)" }
        }
    }

    private func refreshConfig() async {
        if let cfg = try? await api.cloudJudgeConfig() {
            await MainActor.run { config = cfg }
        }
    }
}

// MARK: - Mode Card

private struct ModeCard: View {
    let mode: String
    let title: String
    let description: String
    let icon: String
    let currentMode: String
    let disabled: Bool
    let onSelect: () -> Void

    private var isSelected: Bool { currentMode == mode }
    private var iconColor: Color { disabled ? .secondary : isSelected ? .blue : .secondary }
    private var titleColor: Color { disabled ? .secondary : isSelected ? .blue : .primary }
    private var descColor: Color { disabled ? Color.secondary.opacity(0.5) : .secondary }
    private var bgColor: Color {
        disabled ? Color(.quaternarySystemFill).opacity(0.2)
            : isSelected ? Color.blue.opacity(0.08)
            : Color(.quaternarySystemFill).opacity(0.5)
    }
    private var borderColor: Color {
        disabled ? Color.gray.opacity(0.1)
            : isSelected ? Color.blue.opacity(0.4)
            : Color.gray.opacity(0.15)
    }
    private var checkIcon: String { isSelected && !disabled ? "checkmark.circle.fill" : "circle" }
    private var checkColor: Color { isSelected && !disabled ? .blue : Color.secondary.opacity(0.4) }

    var body: some View {
        Button(action: { if !disabled { onSelect() } }) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 15))
                    .foregroundStyle(iconColor)
                    .frame(width: 20)
                    .padding(.top, 2)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(title)
                            .font(.subheadline).fontWeight(.semibold)
                            .foregroundStyle(titleColor)
                        if disabled {
                            Text("Cloud required")
                                .font(.system(size: 9, weight: .medium))
                                .padding(.horizontal, 5).padding(.vertical, 2)
                                .background(Color.orange.opacity(0.15))
                                .foregroundStyle(.orange)
                                .clipShape(Capsule())
                        }
                    }
                    Text(description)
                        .font(.caption)
                        .foregroundStyle(descColor)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()

                Image(systemName: checkIcon)
                    .foregroundStyle(checkColor)
                    .padding(.top, 2)
            }
            .padding(12)
            .background(bgColor, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(borderColor, lineWidth: 1))
            .opacity(disabled ? 0.6 : 1.0)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }
}

// MARK: - Model Row

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
                        Text(model.name).font(.subheadline).fontWeight(.semibold)
                            .foregroundStyle(model.loaded ? .green : .primary)
                        if model.recommended == true {
                            Text(L.t("judge.recommended"))
                                .font(.system(size: 8, weight: .bold))
                                .padding(.horizontal, 5).padding(.vertical, 1)
                                .background(.orange.opacity(0.2)).foregroundStyle(.orange)
                                .clipShape(Capsule())
                        }
                    }
                    Text(model.size).font(.caption2).foregroundStyle(.tertiary)
                }
                Spacer()
                actionArea
            }
            if isBusy {
                ProgressView(value: model.downloading ? max(Double(model.progress), 2) / 100.0 : 1.0).tint(.blue)
                Text(model.statusMessage ?? (model.downloading ? L.t("settings.downloading", model.progress) : L.t("settings.loadingModel")))
                    .font(.caption2).foregroundStyle(.blue)
            }
            if let err = model.setupError, !isBusy {
                Label(err, systemImage: "exclamationmark.triangle.fill").font(.caption2).foregroundStyle(.red)
            }
        }
        .padding(12)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10)
            .stroke(model.loaded ? Color.green.opacity(0.4) : isBusy ? Color.blue.opacity(0.3) : Color.gray.opacity(0.2), lineWidth: 1))
    }

    @ViewBuilder
    private var actionArea: some View {
        if model.loaded {
            HStack(spacing: 6) {
                Circle().fill(.green).frame(width: 6, height: 6)
                Text(L.t("common.active")).font(.caption2).foregroundStyle(.green)
                Button(L.t("common.stop")) { Task { _ = try? await api.unloadModel(); onRefresh() } }.controlSize(.small)
            }
        } else if model.downloading {
            Button(L.t("common.cancel")) { Task { _ = try? await api.cancelDownload(id: model.id); onRefresh() } }.controlSize(.small)
        } else if model.downloaded {
            Button(L.t("common.run")) { Task { _ = try? await api.setupModel(id: model.id); onRefresh() } }.controlSize(.small)
        } else {
            Button(L.t("settings.setupRun")) { Task { _ = try? await api.setupModel(id: model.id); onRefresh() } }.controlSize(.small)
        }
    }
}
