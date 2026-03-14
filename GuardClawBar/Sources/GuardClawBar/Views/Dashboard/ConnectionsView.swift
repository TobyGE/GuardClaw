import SwiftUI

struct ConnectionsView: View {
    @Environment(AppState.self) var appState
    @State private var ccInstalled: Bool? = nil
    @State private var ccMessage: String? = nil
    @State private var ocPluginInstalled: Bool? = nil
    @State private var ocMessage: String? = nil
    @State private var geminiInstalled: Bool? = nil
    @State private var geminiMessage: String? = nil
    @State private var cursorInstalled: Bool? = nil
    @State private var cursorMessage: String? = nil
    @State private var opencodeInstalled: Bool? = nil
    @State private var opencodeMessage: String? = nil
    @State private var gatewayToken = ""
    @State private var tokenMessage: String? = nil
    @State private var isSavingToken = false
    private var L: Loc { Loc.shared }

    private let api = GuardClawAPI()

    private var ocConnected: Bool {
        appState.serverStatus?.backends?["openclaw"]?.connected == true
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Claude Code
                claudeCodeSection

                Divider()

                // OpenClaw
                openClawSection

                Divider()

                // Gemini CLI
                geminiCLISection

                Divider()

                // Cursor
                cursorSection

                Divider()

                // OpenCode
                openCodeSection
            }
            .padding(24)
        }
        .navigationTitle(L.t("connections.title"))
        .task {
            await checkCCStatus()
            await checkOCPluginStatus()
            await checkGeminiStatus()
            await checkCursorStatus()
            await checkOpenCodeStatus()
        }
    }

    // MARK: - Claude Code

    private var claudeCodeSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Circle()
                    .fill(ccInstalled == true ? Color.green : Color.gray)
                    .frame(width: 10, height: 10)
                Text("Claude Code")
                    .font(.headline)
                Spacer()
                Text(ccInstalled == true ? L.t("connections.hooksInstalled") : L.t("common.notConnected"))
                    .font(.caption)
                    .foregroundStyle(ccInstalled == true ? .green : .secondary)
            }

            Text(L.t("connections.ccDesc"))
                .font(.caption)
                .foregroundStyle(.secondary)

            if ccInstalled == true {
                HStack {
                    Label(L.t("connections.hooksActive"), systemImage: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                    Spacer()
                    Button(L.t("common.uninstall")) {
                        Task { await uninstallCC() }
                    }
                    .controlSize(.small)
                }
            } else {
                Button {
                    Task { await setupCC() }
                } label: {
                    Label(L.t("connections.installHooks"), systemImage: "plus.circle")
                }
                .buttonStyle(.borderedProminent)
            }

            if let msg = ccMessage {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(msg.contains("\u{2713}") ? .green : .red)
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - OpenClaw

    private var openClawSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Circle()
                    .fill(ocConnected ? Color.green : Color.gray)
                    .frame(width: 10, height: 10)
                Text(L.t("connections.ocGateway"))
                    .font(.headline)
                Spacer()
                Text(ocConnected ? L.t("common.connected") : L.t("common.notConnected"))
                    .font(.caption)
                    .foregroundStyle(ocConnected ? .green : .secondary)
            }

            // Plugin status
            if ocPluginInstalled == true {
                HStack {
                    Label(L.t("connections.pluginInstalled"), systemImage: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                    Spacer()
                    Button(L.t("common.uninstall")) {
                        Task { await uninstallOCPlugin() }
                    }
                    .controlSize(.small)
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text(L.t("connections.ocNeedPlugin"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button {
                        Task { await setupOCPlugin() }
                    } label: {
                        Label(L.t("connections.installPlugin"), systemImage: "plus.circle")
                    }
                    .buttonStyle(.borderedProminent)
                }
            }

            if let msg = ocMessage {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(msg.contains("\u{2713}") ? .green : .red)
            }

            Divider()

            // Token section
            Text(L.t("connections.tokenDesc"))
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                SecureField(L.t("connections.tokenPlaceholder"), text: $gatewayToken)
                    .textFieldStyle(.roundedBorder)

                Button(L.t("common.detect")) {
                    Task { await detectToken() }
                }
                .controlSize(.small)

                Button(L.t("common.save")) {
                    Task { await saveToken() }
                }
                .controlSize(.small)
                .disabled(gatewayToken.isEmpty || isSavingToken)
                .buttonStyle(.borderedProminent)
            }

            if let msg = tokenMessage {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(msg.contains("\u{2713}") ? .green : .secondary)
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Gemini CLI

    private var geminiConnected: Bool {
        appState.serverStatus?.backends?["gemini-cli"]?.connected == true
    }

    private var geminiCLISection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Circle()
                    .fill(geminiConnected ? Color.green : Color.gray)
                    .frame(width: 10, height: 10)
                Text("Gemini CLI")
                    .font(.headline)
                Spacer()
                Text(geminiConnected ? L.t("common.connected") : L.t("common.notConnected"))
                    .font(.caption)
                    .foregroundStyle(geminiConnected ? .green : .secondary)
            }

            Text(L.t("connections.geminiDesc"))
                .font(.caption)
                .foregroundStyle(.secondary)

            if geminiInstalled == true {
                HStack {
                    Label(L.t("connections.hooksActive"), systemImage: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                    Spacer()
                    Button(L.t("common.uninstall")) {
                        Task { await uninstallGemini() }
                    }
                    .controlSize(.small)
                }
            } else {
                Button {
                    Task { await setupGemini() }
                } label: {
                    Label(L.t("connections.installHooks"), systemImage: "plus.circle")
                }
                .buttonStyle(.borderedProminent)
            }

            if let msg = geminiMessage {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(msg.contains("\u{2713}") ? .green : .red)
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Actions

    private func checkCCStatus() async {
        if let status = try? await api.claudeCodeStatus() {
            ccInstalled = status.installed
        }
    }

    private func checkOCPluginStatus() async {
        if let status = try? await api.openClawPluginStatus() {
            ocPluginInstalled = status.installed
        }
    }

    private func setupCC() async {
        do {
            _ = try await api.setupClaudeCode()
            ccInstalled = true
            ccMessage = "\u{2713} " + L.t("connections.hooksInstalledRestart", "Claude Code")
        } catch {
            ccMessage = L.t("settings.failed", error.localizedDescription)
        }
    }

    private func setupOCPlugin() async {
        do {
            _ = try await api.setupOpenClaw()
            ocPluginInstalled = true
            ocMessage = "\u{2713} " + L.t("connections.pluginInstalledRestart", "OpenClaw")
        } catch {
            ocMessage = L.t("settings.failed", error.localizedDescription)
        }
    }

    private func uninstallCC() async {
        do {
            _ = try await api.uninstallClaudeCode()
            ccInstalled = false
            ccMessage = L.t("connections.hooksRemovedRestart", "Claude Code")
        } catch {
            ccMessage = L.t("settings.failed", error.localizedDescription)
        }
    }

    private func uninstallOCPlugin() async {
        do {
            _ = try await api.uninstallOpenClaw()
            ocPluginInstalled = false
            ocMessage = L.t("connections.pluginRemovedRestart", "OpenClaw")
        } catch {
            ocMessage = L.t("settings.failed", error.localizedDescription)
        }
    }

    private func checkGeminiStatus() async {
        if let status = try? await api.geminiCLIStatus() {
            geminiInstalled = status.installed
        }
    }

    private func setupGemini() async {
        do {
            _ = try await api.setupGeminiCLI()
            geminiInstalled = true
            geminiMessage = "\u{2713} " + L.t("connections.hooksInstalledRestart", "Gemini CLI")
        } catch {
            geminiMessage = L.t("settings.failed", error.localizedDescription)
        }
    }

    private func uninstallGemini() async {
        do {
            _ = try await api.uninstallGeminiCLI()
            geminiInstalled = false
            geminiMessage = L.t("connections.hooksRemovedRestart", "Gemini CLI")
        } catch {
            geminiMessage = L.t("settings.failed", error.localizedDescription)
        }
    }

    // MARK: - Cursor

    private var cursorConnected: Bool {
        appState.serverStatus?.backends?["cursor"]?.connected == true
    }

    private var cursorSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Circle()
                    .fill(cursorConnected ? Color.green : Color.gray)
                    .frame(width: 10, height: 10)
                Text("Cursor")
                    .font(.headline)
                Spacer()
                Text(cursorConnected ? L.t("common.connected") : L.t("common.notConnected"))
                    .font(.caption)
                    .foregroundStyle(cursorConnected ? .green : .secondary)
            }

            Text(L.t("connections.cursorDesc"))
                .font(.caption)
                .foregroundStyle(.secondary)

            if cursorInstalled == true {
                HStack {
                    Label(L.t("connections.hooksActive"), systemImage: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                    Spacer()
                    Button(L.t("common.uninstall")) {
                        Task { await uninstallCursor() }
                    }
                    .controlSize(.small)
                }
            } else {
                Button {
                    Task { await setupCursor() }
                } label: {
                    Label(L.t("connections.installHooks"), systemImage: "plus.circle")
                }
                .buttonStyle(.borderedProminent)
            }

            if let msg = cursorMessage {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(msg.contains("\u{2713}") ? .green : .red)
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    private func checkCursorStatus() async {
        if let status = try? await api.cursorStatus() {
            cursorInstalled = status.installed
        }
    }

    private func setupCursor() async {
        do {
            _ = try await api.setupCursor()
            cursorInstalled = true
            cursorMessage = "\u{2713} " + L.t("connections.hooksInstalledRestart", "Cursor")
        } catch {
            cursorMessage = L.t("settings.failed", error.localizedDescription)
        }
    }

    private func uninstallCursor() async {
        do {
            _ = try await api.uninstallCursor()
            cursorInstalled = false
            cursorMessage = L.t("connections.hooksRemovedRestart", "Cursor")
        } catch {
            cursorMessage = L.t("settings.failed", error.localizedDescription)
        }
    }

    // MARK: - OpenCode

    private var opencodeConnected: Bool {
        appState.serverStatus?.backends?["opencode"]?.connected == true
    }

    private var openCodeSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Circle()
                    .fill(opencodeConnected ? Color.green : Color.gray)
                    .frame(width: 10, height: 10)
                Text("OpenCode")
                    .font(.headline)
                Spacer()
                Text(opencodeConnected ? L.t("common.connected") : L.t("common.notConnected"))
                    .font(.caption)
                    .foregroundStyle(opencodeConnected ? .green : .secondary)
            }

            Text(L.t("connections.opencodeDesc"))
                .font(.caption)
                .foregroundStyle(.secondary)

            if opencodeInstalled == true {
                HStack {
                    Label(L.t("connections.pluginActive"), systemImage: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                    Spacer()
                    Button(L.t("common.uninstall")) {
                        Task { await uninstallOpenCode() }
                    }
                    .controlSize(.small)
                }
            } else {
                Button {
                    Task { await setupOpenCode() }
                } label: {
                    Label(L.t("connections.installPlugin"), systemImage: "plus.circle")
                }
                .buttonStyle(.borderedProminent)
            }

            if let msg = opencodeMessage {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(msg.contains("\u{2713}") ? .green : .red)
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    private func checkOpenCodeStatus() async {
        if let status = try? await api.openCodeStatus() {
            opencodeInstalled = status.installed
        }
    }

    private func setupOpenCode() async {
        do {
            _ = try await api.setupOpenCode()
            opencodeInstalled = true
            opencodeMessage = "\u{2713} " + L.t("connections.pluginInstalledRestart", "OpenCode")
        } catch {
            opencodeMessage = L.t("settings.failed", error.localizedDescription)
        }
    }

    private func uninstallOpenCode() async {
        do {
            _ = try await api.uninstallOpenCode()
            opencodeInstalled = false
            opencodeMessage = L.t("connections.pluginRemovedRestart", "OpenCode")
        } catch {
            opencodeMessage = L.t("settings.failed", error.localizedDescription)
        }
    }

    private func detectToken() async {
        do {
            let resp = try await api.detectToken()
            if let t = resp.token {
                gatewayToken = t
                tokenMessage = "\u{2713} " + L.t("connections.autoDetected")
            } else {
                tokenMessage = L.t("connections.noTokenFound")
            }
        } catch {
            tokenMessage = L.t("settings.notFound")
        }
    }

    private func saveToken() async {
        isSavingToken = true
        do {
            _ = try await api.saveToken(token: gatewayToken)
            tokenMessage = "\u{2713} " + L.t("connections.tokenSaved")
        } catch {
            tokenMessage = L.t("settings.failed", error.localizedDescription)
        }
        isSavingToken = false
    }
}
