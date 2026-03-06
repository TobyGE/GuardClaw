import SwiftUI

struct SettingsView: View {
    @State private var serverURL: String = SettingsStore.shared.serverURL
    @State private var pollInterval: Double = SettingsStore.shared.pollInterval
    @State private var models: [BuiltinModel] = []
    @State private var isLoadingModels = true
    @State private var ccHooksInstalled: Bool? = nil
    @State private var ccSetupMessage: String? = nil
    @State private var ocConnected = false
    @State private var blockingEnabled = false
    @State private var failClosedEnabled = false
    @State private var llmBackend: String? = nil
    @State private var llmConnected: Bool? = nil
    @State private var gatewayToken: String = ""
    @State private var tokenMessage: String? = nil

    private let api = GuardClawAPI()
    private let timer = Timer.publish(every: 1.5, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Settings")
                    .font(.headline)

                // -- Judge --
                VStack(alignment: .leading, spacing: 6) {
                    // Backend picker row
                    HStack {
                        Circle()
                            .fill(llmConnected == true ? Color.green : Color.gray)
                            .frame(width: 6, height: 6)
                        Text("Judge")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Picker("", selection: Binding(
                            get: { llmBackend ?? "built-in" },
                            set: { newVal in
                                Task {
                                    _ = try? await api.switchLLMBackend(backend: newVal)
                                    llmBackend = newVal
                                }
                            }
                        )) {
                            Text("Built-in").tag("built-in")
                            Text("LM Studio").tag("lmstudio")
                            Text("Ollama").tag("ollama")
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
                }

                Divider()

                // -- Connections --
                VStack(alignment: .leading, spacing: 8) {
                    Text("Connections")
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
                            Text("Hooks installed")
                                .font(.system(size: 9))
                                .foregroundStyle(.green)
                        } else {
                            Button("Setup") { setupClaudeCode() }
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
                        Text(ocConnected ? "Connected" : "Not connected")
                            .font(.system(size: 9))
                            .foregroundStyle(ocConnected ? .green : .secondary)
                    }

                    if let msg = ccSetupMessage {
                        Text(msg)
                            .font(.system(size: 9))
                            .foregroundStyle(msg.contains("✓") ? .green : .red)
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
            if let serverStatus = try? await api.status() {
                await MainActor.run {
                    ocConnected = serverStatus.backends?["openclaw"]?.connected == true
                    blockingEnabled = serverStatus.approvals?.mode == "blocking"
                    failClosedEnabled = serverStatus.failClosed == true
                    llmBackend = serverStatus.llmStatus?.backend
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
                    ccSetupMessage = "✓ Hooks installed — restart Claude Code to activate"
                }
            } catch {
                await MainActor.run {
                    ccSetupMessage = "Failed: \(error.localizedDescription)"
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

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Protection")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack {
                Toggle(isOn: Binding(
                    get: { blockingEnabled },
                    set: { newVal in
                        Task {
                            _ = try? await api.toggleBlocking(enabled: newVal)
                            blockingEnabled = newVal
                        }
                    }
                )) {
                    Text("Active Blocking")
                        .font(.caption)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
            }

            Text(blockingEnabled ? "Risky tool calls require approval" : "Monitor only — nothing blocked")
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
                    Text("Fail-Closed (Offline)")
                        .font(.caption)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
            }
        }
    }
}

// MARK: - Gateway Token Section

private struct GatewayTokenSection: View {
    @Binding var token: String
    @Binding var message: String?
    let api: GuardClawAPI

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Gateway Token")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 4) {
                SecureField("Token", text: $token)
                    .textFieldStyle(.roundedBorder)
                    .font(.caption)
                    .onSubmit { saveToken() }

                Button("Save") { saveToken() }
                    .font(.system(size: 9))
                    .controlSize(.mini)

                Button("Detect") { detectToken() }
                    .font(.system(size: 9))
                    .controlSize(.mini)
            }

            if let msg = message {
                Text(msg)
                    .font(.system(size: 9))
                    .foregroundStyle(msg.contains("✓") ? .green : .secondary)
            }
        }
    }

    private func saveToken() {
        guard !token.isEmpty else { return }
        Task {
            do {
                _ = try await api.saveToken(token: token)
                await MainActor.run { message = "✓ Token saved" }
            } catch {
                await MainActor.run { message = "Failed: \(error.localizedDescription)" }
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
                        message = "✓ Auto-detected from OpenClaw config"
                    } else {
                        message = "No token found in OpenClaw config"
                    }
                }
            } catch {
                await MainActor.run { message = "Not found" }
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
