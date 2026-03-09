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
    @State private var gatewayToken = ""
    @State private var tokenMessage: String? = nil
    @State private var isSavingToken = false

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
            }
            .padding(24)
        }
        .navigationTitle("Connections")
        .task {
            await checkCCStatus()
            await checkOCPluginStatus()
            await checkGeminiStatus()
            await checkCursorStatus()
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
                Text(ccInstalled == true ? "Hooks installed" : "Not connected")
                    .font(.caption)
                    .foregroundStyle(ccInstalled == true ? .green : .secondary)
            }

            Text("GuardClaw intercepts Claude Code tool calls via hooks installed in ~/.claude/settings.json.")
                .font(.caption)
                .foregroundStyle(.secondary)

            if ccInstalled == true {
                HStack {
                    Label("Hooks are active.", systemImage: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                    Spacer()
                    Button("Uninstall") {
                        Task { await uninstallCC() }
                    }
                    .controlSize(.small)
                }
            } else {
                Button {
                    Task { await setupCC() }
                } label: {
                    Label("Install Hooks", systemImage: "plus.circle")
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
                Text("OpenClaw Gateway")
                    .font(.headline)
                Spacer()
                Text(ocConnected ? "Connected" : "Not connected")
                    .font(.caption)
                    .foregroundStyle(ocConnected ? .green : .secondary)
            }

            // Plugin status
            if ocPluginInstalled == true {
                HStack {
                    Label("Interceptor plugin installed.", systemImage: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                    Spacer()
                    Button("Uninstall") {
                        Task { await uninstallOCPlugin() }
                    }
                    .controlSize(.small)
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("The GuardClaw interceptor plugin needs to be installed in OpenClaw to enable tool call blocking.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button {
                        Task { await setupOCPlugin() }
                    } label: {
                        Label("Install Plugin", systemImage: "plus.circle")
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
            Text("Gateway token for real-time event streaming.")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                SecureField("Gateway token...", text: $gatewayToken)
                    .textFieldStyle(.roundedBorder)

                Button("Detect") {
                    Task { await detectToken() }
                }
                .controlSize(.small)

                Button("Save") {
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
                Text(geminiConnected ? "Connected" : "Not connected")
                    .font(.caption)
                    .foregroundStyle(geminiConnected ? .green : .secondary)
            }

            Text("GuardClaw intercepts Gemini CLI tool calls via hooks installed in ~/.gemini/settings.json.")
                .font(.caption)
                .foregroundStyle(.secondary)

            if geminiInstalled == true {
                HStack {
                    Label("Hooks are active.", systemImage: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                    Spacer()
                    Button("Uninstall") {
                        Task { await uninstallGemini() }
                    }
                    .controlSize(.small)
                }
            } else {
                Button {
                    Task { await setupGemini() }
                } label: {
                    Label("Install Hooks", systemImage: "plus.circle")
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
            ccMessage = "\u{2713} Hooks installed — restart Claude Code to activate"
        } catch {
            ccMessage = "Failed: \(error.localizedDescription)"
        }
    }

    private func setupOCPlugin() async {
        do {
            _ = try await api.setupOpenClaw()
            ocPluginInstalled = true
            ocMessage = "\u{2713} Plugin installed — restart OpenClaw to activate"
        } catch {
            ocMessage = "Failed: \(error.localizedDescription)"
        }
    }

    private func uninstallCC() async {
        do {
            _ = try await api.uninstallClaudeCode()
            ccInstalled = false
            ccMessage = "Hooks removed — restart Claude Code"
        } catch {
            ccMessage = "Failed: \(error.localizedDescription)"
        }
    }

    private func uninstallOCPlugin() async {
        do {
            _ = try await api.uninstallOpenClaw()
            ocPluginInstalled = false
            ocMessage = "Plugin removed — restart OpenClaw"
        } catch {
            ocMessage = "Failed: \(error.localizedDescription)"
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
            geminiMessage = "\u{2713} Hooks installed — restart Gemini CLI to activate"
        } catch {
            geminiMessage = "Failed: \(error.localizedDescription)"
        }
    }

    private func uninstallGemini() async {
        do {
            _ = try await api.uninstallGeminiCLI()
            geminiInstalled = false
            geminiMessage = "Hooks removed — restart Gemini CLI"
        } catch {
            geminiMessage = "Failed: \(error.localizedDescription)"
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
                Text(cursorConnected ? "Connected" : "Not connected")
                    .font(.caption)
                    .foregroundStyle(cursorConnected ? .green : .secondary)
            }

            Text("GuardClaw intercepts Cursor tool calls via hooks installed in ~/.cursor/hooks.json.")
                .font(.caption)
                .foregroundStyle(.secondary)

            if cursorInstalled == true {
                HStack {
                    Label("Hooks are active.", systemImage: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                    Spacer()
                    Button("Uninstall") {
                        Task { await uninstallCursor() }
                    }
                    .controlSize(.small)
                }
            } else {
                Button {
                    Task { await setupCursor() }
                } label: {
                    Label("Install Hooks", systemImage: "plus.circle")
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
            cursorMessage = "\u{2713} Hooks installed — restart Cursor to activate"
        } catch {
            cursorMessage = "Failed: \(error.localizedDescription)"
        }
    }

    private func uninstallCursor() async {
        do {
            _ = try await api.uninstallCursor()
            cursorInstalled = false
            cursorMessage = "Hooks removed — restart Cursor"
        } catch {
            cursorMessage = "Failed: \(error.localizedDescription)"
        }
    }

    private func detectToken() async {
        do {
            let resp = try await api.detectToken()
            if let t = resp.token {
                gatewayToken = t
                tokenMessage = "\u{2713} Auto-detected from OpenClaw config"
            } else {
                tokenMessage = "No token found"
            }
        } catch {
            tokenMessage = "Not found"
        }
    }

    private func saveToken() async {
        isSavingToken = true
        do {
            _ = try await api.saveToken(token: gatewayToken)
            tokenMessage = "\u{2713} Token saved, reconnecting..."
        } catch {
            tokenMessage = "Failed: \(error.localizedDescription)"
        }
        isSavingToken = false
    }
}
