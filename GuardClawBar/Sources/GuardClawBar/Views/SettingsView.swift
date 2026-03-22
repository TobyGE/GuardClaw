import SwiftUI

struct SettingsView: View {
    @State private var serverURL: String = SettingsStore.shared.serverURL
    @State private var pollInterval: Double = SettingsStore.shared.pollInterval
    @State private var models: [BuiltinModel] = []
    @State private var isLoadingModels = true
    @State private var ccHooksInstalled: Bool? = nil
    @State private var ccSetupMessage: String? = nil
    @State private var ocConnected = false
    @State private var ocPluginInstalled: Bool? = nil
    @State private var ocSetupMessage: String? = nil
    @State private var geminiInstalled: Bool? = nil
    @State private var geminiMessage: String? = nil
    @State private var copilotInstalled: Bool? = nil
    @State private var copilotMessage: String? = nil
    @State private var cursorInstalled: Bool? = nil
    @State private var cursorMessage: String? = nil
    @State private var blockingEnabled = false
    @State private var failClosedEnabled = false
    @State private var llmBackend: String? = nil
    @State private var isChangingBackend = false
    @State private var llmConnected: Bool? = nil
    @State private var gatewayToken: String = ""
    @State private var tokenMessage: String? = nil
    private var L: Loc { Loc.shared }

    private let api = GuardClawAPI()
    private let timer = Timer.publish(every: 10, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(L.t("settings.title"))
                    .font(.headline)

                // -- Language toggle --
                HStack {
                    Text(L.t("settings.language"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Picker("", selection: Binding(
                        get: { Loc.shared.lang },
                        set: { Loc.shared.lang = $0 }
                    )) {
                        Text("EN").tag("en")
                        Text("中文").tag("zh")
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 100)
                }

                // -- Judge --
                VStack(alignment: .leading, spacing: 6) {
                    // Backend picker row
                    HStack {
                        Circle()
                            .fill(llmConnected == true ? Color.green : Color.gray)
                            .frame(width: 6, height: 6)
                        Text(L.t("settings.judge"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Picker("", selection: Binding(
                            get: { llmBackend ?? "built-in" },
                            set: { newVal in
                                llmBackend = newVal
                                isChangingBackend = true
                                Task {
                                    _ = try? await api.switchLLMBackend(backend: newVal)
                                    await MainActor.run { isChangingBackend = false }
                                }
                            }
                        )) {
                            Text(L.t("settings.builtIn")).tag("built-in")
                            Text(L.t("settings.lmStudio")).tag("lmstudio")
                            Text(L.t("settings.ollama")).tag("ollama")
                        }
                        .pickerStyle(.menu)
                        .controlSize(.mini)
                        .frame(width: 110)
                    }

                    // Built-in model row (only when built-in selected)
                    if llmBackend == "built-in" || llmBackend == nil {
                        if isLoadingModels && models.isEmpty {
                            HStack {
                                ProgressView().controlSize(.small)
                                Text(L.t("common.loading"))
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            .frame(height: 50)
                        }

                        ForEach(models) { m in
                            ModelRowView(model: m, api: api, onRefresh: { fetchModels() })
                        }
                    }
                }

                Divider()

                // -- Connections --
                VStack(alignment: .leading, spacing: 8) {
                    Text(L.t("settings.connections"))
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    // Claude Code
                    HStack {
                        Circle()
                            .fill(ccHooksInstalled == true ? Color.green : Color.gray)
                            .frame(width: 6, height: 6)
                        Text("Claude Code")
                            .font(.caption)
                        Spacer()
                        if ccHooksInstalled == true {
                            Text("\u{2713}")
                                .font(.system(size: 9))
                                .foregroundStyle(.green)
                            Button(L.t("common.uninstall")) { uninstallClaudeCode() }
                                .font(.system(size: 9))
                                .controlSize(.mini)
                        } else {
                            Button(L.t("common.install")) { setupClaudeCode() }
                                .font(.system(size: 9))
                                .controlSize(.mini)
                        }
                    }

                    // OpenClaw
                    HStack {
                        Circle()
                            .fill(ocConnected ? Color.green : Color.gray)
                            .frame(width: 6, height: 6)
                        Text("OpenClaw")
                            .font(.caption)
                        Spacer()
                        if ocPluginInstalled == true {
                            Text("\u{2713}")
                                .font(.system(size: 9))
                                .foregroundStyle(.green)
                            Button(L.t("common.uninstall")) { uninstallOpenClaw() }
                                .font(.system(size: 9))
                                .controlSize(.mini)
                        } else {
                            Button(L.t("common.install")) { setupOpenClaw() }
                                .font(.system(size: 9))
                                .controlSize(.mini)
                        }
                    }

                    if let msg = ccSetupMessage {
                        Text(msg)
                            .font(.system(size: 9))
                            .foregroundStyle(msg.contains("\u{2713}") ? .green : .red)
                    }

                    // Gemini CLI
                    HStack {
                        Circle()
                            .fill(geminiInstalled == true ? Color.green : Color.gray)
                            .frame(width: 6, height: 6)
                        Text("Gemini CLI")
                            .font(.caption)
                        Spacer()
                        if geminiInstalled == true {
                            Text("\u{2713}")
                                .font(.system(size: 9))
                                .foregroundStyle(.green)
                            Button(L.t("common.uninstall")) { uninstallGeminiCLI() }
                                .font(.system(size: 9))
                                .controlSize(.mini)
                        } else {
                            Button(L.t("common.install")) { setupGeminiCLI() }
                                .font(.system(size: 9))
                                .controlSize(.mini)
                        }
                    }

                    // Copilot CLI
                    HStack {
                        Circle()
                            .fill(copilotInstalled == true ? Color.green : Color.gray)
                            .frame(width: 6, height: 6)
                        Text("Copilot CLI")
                            .font(.caption)
                        Spacer()
                        if copilotInstalled == true {
                            Text("\u{2713}")
                                .font(.system(size: 9))
                                .foregroundStyle(.green)
                            Button(L.t("common.uninstall")) { uninstallCopilot() }
                                .font(.system(size: 9))
                                .controlSize(.mini)
                        } else {
                            Button(L.t("common.install")) { setupCopilot() }
                                .font(.system(size: 9))
                                .controlSize(.mini)
                        }
                    }

                    // Cursor
                    HStack {
                        Circle()
                            .fill(cursorInstalled == true ? Color.green : Color.gray)
                            .frame(width: 6, height: 6)
                        Text("Cursor")
                            .font(.caption)
                        Spacer()
                        if cursorInstalled == true {
                            Text("\u{2713}")
                                .font(.system(size: 9))
                                .foregroundStyle(.green)
                            Button(L.t("common.uninstall")) { uninstallCursor() }
                                .font(.system(size: 9))
                                .controlSize(.mini)
                        } else {
                            Button(L.t("common.install")) { setupCursor() }
                                .font(.system(size: 9))
                                .controlSize(.mini)
                        }
                    }

                    if let msg = ccSetupMessage {
                        Text(msg)
                            .font(.system(size: 9))
                            .foregroundStyle(msg.contains("\u{2713}") ? .green : .red)
                    }

                    if let msg = ocSetupMessage {
                        Text(msg)
                            .font(.system(size: 9))
                            .foregroundStyle(msg.contains("\u{2713}") ? .green : .red)
                    }

                    if let msg = geminiMessage {
                        Text(msg)
                            .font(.system(size: 9))
                            .foregroundStyle(msg.contains("\u{2713}") ? .green : .red)
                    }

                    if let msg = copilotMessage {
                        Text(msg)
                            .font(.system(size: 9))
                            .foregroundStyle(msg.contains("\u{2713}") ? .green : .red)
                    }

                    if let msg = cursorMessage {
                        Text(msg)
                            .font(.system(size: 9))
                            .foregroundStyle(msg.contains("\u{2713}") ? .green : .red)
                    }
                }

                Divider()

                // -- Protection --
                ProtectionSection(
                    blockingEnabled: $blockingEnabled,
                    failClosedEnabled: $failClosedEnabled,
                    api: api
                )

                Divider()

                // -- Gateway Token --
                GatewayTokenSection(
                    token: $gatewayToken,
                    message: $tokenMessage,
                    api: api
                )

                Divider()

                // -- Server URL --
                VStack(alignment: .leading, spacing: 4) {
                    Text(L.t("settings.serverURL"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField("http://localhost:3002", text: $serverURL)
                        .textFieldStyle(.roundedBorder)
                        .font(.caption)
                        .onSubmit { save() }
                }

                // -- Poll Interval --
                VStack(alignment: .leading, spacing: 4) {
                    Text(L.t("settings.pollInterval", String(format: "%.0f", pollInterval)))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Slider(value: $pollInterval, in: 1...30, step: 1)
                        .onChange(of: pollInterval) { _, _ in save() }
                }

                HStack {
                    Spacer()
                    Button(L.t("common.save")) { save() }
                        .controlSize(.small)
                }
            }
            .padding(16)
        }
        .frame(width: 300, height: 620)
        .onAppear { fetchModels(); checkCCStatus() }
        .onReceive(timer) { _ in fetchModels(); checkCCStatus() }
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

    private func checkCCStatus() {
        Task {
            if let status = try? await api.claudeCodeStatus() {
                await MainActor.run { ccHooksInstalled = status.installed }
            }
            if let status = try? await api.openClawPluginStatus() {
                await MainActor.run { ocPluginInstalled = status.installed }
            }
            if let status = try? await api.geminiCLIStatus() {
                await MainActor.run { geminiInstalled = status.installed }
            }
            if let status = try? await api.copilotStatus() {
                await MainActor.run { copilotInstalled = status.installed }
            }
            if let status = try? await api.cursorStatus() {
                await MainActor.run { cursorInstalled = status.installed }
            }
            if let serverStatus = try? await api.status() {
                await MainActor.run {
                    ocConnected = serverStatus.backends?["openclaw"]?.connected == true
                    blockingEnabled = serverStatus.blocking?.active ?? serverStatus.blocking?.enabled ?? false
                    failClosedEnabled = serverStatus.failClosed == true
                    if !isChangingBackend {
                        llmBackend = serverStatus.llmStatus?.backend
                    }
                    llmConnected = serverStatus.llmStatus?.connected
                }
            }
        }
    }

    private func setupClaudeCode() {
        Task {
            do {
                _ = try await api.setupClaudeCode()
                await MainActor.run {
                    ccHooksInstalled = true
                    ccSetupMessage = "\u{2713} " + Loc.shared.t("settings.hooksInstalled", "Claude Code")
                }
            } catch {
                await MainActor.run {
                    ccSetupMessage = Loc.shared.t("settings.failed", error.localizedDescription)
                }
            }
        }
    }

    private func setupOpenClaw() {
        Task {
            do {
                _ = try await api.setupOpenClaw()
                await MainActor.run {
                    ocPluginInstalled = true
                    ocSetupMessage = "\u{2713} " + Loc.shared.t("settings.pluginInstalled", "OpenClaw")
                }
            } catch {
                await MainActor.run {
                    ocSetupMessage = Loc.shared.t("settings.failed", error.localizedDescription)
                }
            }
        }
    }

    private func uninstallClaudeCode() {
        Task {
            do {
                _ = try await api.uninstallClaudeCode()
                await MainActor.run {
                    ccHooksInstalled = false
                    ccSetupMessage = Loc.shared.t("settings.hooksRemoved", "Claude Code")
                }
            } catch {
                await MainActor.run {
                    ccSetupMessage = Loc.shared.t("settings.failed", error.localizedDescription)
                }
            }
        }
    }

    private func uninstallOpenClaw() {
        Task {
            do {
                _ = try await api.uninstallOpenClaw()
                await MainActor.run {
                    ocPluginInstalled = false
                    ocSetupMessage = Loc.shared.t("settings.pluginRemoved", "OpenClaw")
                }
            } catch {
                await MainActor.run {
                    ocSetupMessage = Loc.shared.t("settings.failed", error.localizedDescription)
                }
            }
        }
    }

    private func setupGeminiCLI() {
        Task {
            do {
                _ = try await api.setupGeminiCLI()
                await MainActor.run {
                    geminiInstalled = true
                    geminiMessage = "\u{2713} " + Loc.shared.t("settings.hooksInstalled", "Gemini CLI")
                }
            } catch {
                await MainActor.run {
                    geminiMessage = Loc.shared.t("settings.failed", error.localizedDescription)
                }
            }
        }
    }

    private func uninstallGeminiCLI() {
        Task {
            do {
                _ = try await api.uninstallGeminiCLI()
                await MainActor.run {
                    geminiInstalled = false
                    geminiMessage = Loc.shared.t("settings.hooksRemoved", "Gemini CLI")
                }
            } catch {
                await MainActor.run {
                    geminiMessage = Loc.shared.t("settings.failed", error.localizedDescription)
                }
            }
        }
    }

    private func setupCopilot() {
        Task {
            do {
                _ = try await api.setupCopilot()
                await MainActor.run {
                    copilotInstalled = true
                    copilotMessage = "\u{2713} " + Loc.shared.t("settings.extensionInstalled", "Copilot CLI")
                }
            } catch {
                await MainActor.run {
                    copilotMessage = Loc.shared.t("settings.failed", error.localizedDescription)
                }
            }
        }
    }

    private func uninstallCopilot() {
        Task {
            do {
                _ = try await api.uninstallCopilot()
                await MainActor.run {
                    copilotInstalled = false
                    copilotMessage = Loc.shared.t("settings.extensionRemoved", "Copilot CLI")
                }
            } catch {
                await MainActor.run {
                    copilotMessage = Loc.shared.t("settings.failed", error.localizedDescription)
                }
            }
        }
    }

    private func setupCursor() {
        Task {
            do {
                _ = try await api.setupCursor()
                await MainActor.run {
                    cursorInstalled = true
                    cursorMessage = "\u{2713} " + Loc.shared.t("settings.hooksInstalled", "Cursor")
                }
            } catch {
                await MainActor.run {
                    cursorMessage = Loc.shared.t("settings.failed", error.localizedDescription)
                }
            }
        }
    }

    private func uninstallCursor() {
        Task {
            do {
                _ = try await api.uninstallCursor()
                await MainActor.run {
                    cursorInstalled = false
                    cursorMessage = Loc.shared.t("settings.hooksRemoved", "Cursor")
                }
            } catch {
                await MainActor.run {
                    cursorMessage = Loc.shared.t("settings.failed", error.localizedDescription)
                }
            }
        }
    }
}

// MARK: - Protection Section

private struct ProtectionSection: View {
    @Binding var blockingEnabled: Bool
    @Binding var failClosedEnabled: Bool
    let api: GuardClawAPI
    private var L: Loc { Loc.shared }

    private var failClosedSummary: String {
        failClosedEnabled
            ? L.t("settings.failClosedOn")
            : L.t("settings.failClosedOff")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L.t("settings.protection"))
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack {
                Toggle(isOn: Binding(
                    get: { blockingEnabled },
                    set: { newVal in
                        let previousVal = blockingEnabled
                        blockingEnabled = newVal
                        Task {
                            do {
                                _ = try await api.toggleBlocking(enabled: newVal)
                            } catch {
                                blockingEnabled = previousVal
                            }
                        }
                    }
                )) {
                    Text(L.t("settings.activeBlocking"))
                        .font(.caption)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
            }

            Text(blockingEnabled ? L.t("settings.blockingOn") : L.t("settings.blockingOff"))
                .font(.system(size: 9))
                .foregroundStyle(.secondary)

            HStack {
                Toggle(isOn: Binding(
                    get: { failClosedEnabled },
                    set: { newVal in
                        Task {
                            _ = try? await api.toggleFailClosed(enabled: newVal)
                            failClosedEnabled = newVal
                        }
                    }
                )) {
                    Text(L.t("settings.failClosed"))
                        .font(.caption)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
            }

            Text(failClosedSummary)
                .font(.system(size: 9))
                .foregroundStyle(failClosedEnabled ? Color.secondary : Color.orange)
        }
    }
}

// MARK: - Gateway Token Section

private struct GatewayTokenSection: View {
    @Binding var token: String
    @Binding var message: String?
    let api: GuardClawAPI
    private var L: Loc { Loc.shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(L.t("settings.gatewayToken"))
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 4) {
                SecureField(L.t("settings.tokenPlaceholder"), text: $token)
                    .textFieldStyle(.roundedBorder)
                    .font(.caption)
                    .onSubmit { saveToken() }

                Button(L.t("common.save")) { saveToken() }
                    .font(.system(size: 9))
                    .controlSize(.mini)

                Button(L.t("common.detect")) { detectToken() }
                    .font(.system(size: 9))
                    .controlSize(.mini)
            }

            if let msg = message {
                Text(msg)
                    .font(.system(size: 9))
                    .foregroundStyle(msg.contains("\u{2713}") ? .green : .secondary)
            }
        }
    }

    private func saveToken() {
        guard !token.isEmpty else { return }
        Task {
            do {
                _ = try await api.saveToken(token: token)
                await MainActor.run { message = "\u{2713} " + Loc.shared.t("settings.tokenSaved") }
            } catch {
                await MainActor.run { message = Loc.shared.t("settings.failed", error.localizedDescription) }
            }
        }
    }

    private func detectToken() {
        Task {
            do {
                let resp = try await api.detectToken()
                await MainActor.run {
                    if let t = resp.token {
                        token = t
                        message = "\u{2713} " + Loc.shared.t("settings.autoDetected")
                    } else {
                        message = Loc.shared.t("settings.noTokenFound")
                    }
                }
            } catch {
                await MainActor.run { message = Loc.shared.t("settings.notFound") }
            }
        }
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
                Text(L.t("settings.rec"))
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
            Button(L.t("common.run")) { setup() }
                .font(.system(size: 9))
                .controlSize(.mini)
        } else {
            Button(L.t("settings.setupRun")) { setup() }
                .font(.system(size: 9))
                .controlSize(.mini)
        }
    }

    private var loadedActions: some View {
        HStack(spacing: 4) {
            Circle().fill(.green).frame(width: 6, height: 6)
            Text(L.t("common.active"))
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(.green)
            Button(L.t("common.stop")) { Task { _ = try? await api.unloadModel(); onRefresh() } }
                .font(.system(size: 9))
                .controlSize(.mini)
        }
    }

    private var busyActions: some View {
        Group {
            if model.downloading {
                Button(L.t("common.cancel")) { Task { _ = try? await api.cancelDownload(id: model.id); onRefresh() } }
                    .font(.system(size: 9))
                    .controlSize(.mini)
            }
        }
    }

    private var progressSection: some View {
        VStack(alignment: .leading, spacing: 3) {
            ProgressView(value: model.downloading ? max(Double(model.progress), 2) / 100.0 : 1.0)
                .tint(.blue)

            Text(model.statusMessage ?? (model.downloading ? L.t("settings.downloading", model.progress) : L.t("settings.loadingModel")))
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
