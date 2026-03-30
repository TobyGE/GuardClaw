import SwiftUI

struct SettingsView: View {
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
    @State private var cloudJudgeConfig: CloudJudgeConfig? = nil
    private var L: Loc { Loc.shared }

    private let api = GuardClawAPI()
    private let timer = Timer.publish(every: 10, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(L.t("settings.title"))
                    .font(.headline)

                // -- Language --
                HStack {
                    Text(L.t("settings.language"))
                        .font(.caption).foregroundStyle(.secondary)
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

                Divider()

                // -- Connections --
                VStack(alignment: .leading, spacing: 8) {
                    Text(L.t("settings.connections"))
                        .font(.caption).foregroundStyle(.secondary)

                    connectionRow("Claude Code", installed: ccHooksInstalled, connected: ccHooksInstalled == true,
                                  onInstall: setupClaudeCode, onUninstall: uninstallClaudeCode)
                    if let msg = ccSetupMessage { statusText(msg) }

                    connectionRow("OpenClaw", installed: ocPluginInstalled, connected: ocConnected,
                                  onInstall: setupOpenClaw, onUninstall: uninstallOpenClaw)
                    if let msg = ocSetupMessage { statusText(msg) }

                    connectionRow("Gemini CLI", installed: geminiInstalled, connected: geminiInstalled == true,
                                  onInstall: setupGeminiCLI, onUninstall: uninstallGeminiCLI)
                    if let msg = geminiMessage { statusText(msg) }

                    connectionRow("Copilot CLI", installed: copilotInstalled, connected: copilotInstalled == true,
                                  onInstall: setupCopilot, onUninstall: uninstallCopilot)
                    if let msg = copilotMessage { statusText(msg) }

                    connectionRow("Cursor", installed: cursorInstalled, connected: cursorInstalled == true,
                                  onInstall: setupCursor, onUninstall: uninstallCursor)
                    if let msg = cursorMessage { statusText(msg) }
                }

                Divider()

                // -- Protection --
                ProtectionSection(blockingEnabled: $blockingEnabled, failClosedEnabled: $failClosedEnabled, api: api)

                Divider()

                // -- Judge Mode --
                CloudJudgeSection(config: $cloudJudgeConfig, api: api)

            }
            .padding(16)
        }
        .frame(width: 300, height: 580)
        .onAppear { checkStatus(); fetchCloudJudge() }
        .onReceive(timer) { _ in checkStatus() }
    }

    // MARK: - Helpers

    private func connectionRow(_ name: String, installed: Bool?, connected: Bool,
                                onInstall: @escaping () -> Void, onUninstall: @escaping () -> Void) -> some View {
        HStack {
            Circle().fill(connected ? Color.green : Color.gray).frame(width: 6, height: 6)
            Text(name).font(.caption)
            Spacer()
            if installed == true {
                Text("✓").font(.system(size: 9)).foregroundStyle(.green)
                Button(L.t("common.uninstall"), action: onUninstall)
                    .font(.system(size: 9)).controlSize(.mini)
            } else {
                Button(L.t("common.install"), action: onInstall)
                    .font(.system(size: 9)).controlSize(.mini)
            }
        }
    }

    private func statusText(_ msg: String) -> some View {
        Text(msg).font(.system(size: 9))
            .foregroundStyle(msg.contains("✓") ? .green : .red)
    }

    private func fetchCloudJudge() {
        Task {
            if let cfg = try? await api.cloudJudgeConfig() {
                await MainActor.run { cloudJudgeConfig = cfg }
            }
        }
    }

    private func checkStatus() {
        Task {
            async let cc = api.claudeCodeStatus()
            async let oc = api.openClawPluginStatus()
            async let gem = api.geminiCLIStatus()
            async let cop = api.copilotStatus()
            async let cur = api.cursorStatus()
            async let srv = api.status()

            if let s = try? await cc { await MainActor.run { ccHooksInstalled = s.installed } }
            if let s = try? await oc { await MainActor.run { ocPluginInstalled = s.installed } }
            if let s = try? await gem { await MainActor.run { geminiInstalled = s.installed } }
            if let s = try? await cop { await MainActor.run { copilotInstalled = s.installed } }
            if let s = try? await cur { await MainActor.run { cursorInstalled = s.installed } }
            if let s = try? await srv {
                await MainActor.run {
                    ocConnected = s.backends?["openclaw"]?.connected == true
                    blockingEnabled = s.blocking?.active ?? s.blocking?.enabled ?? false
                    failClosedEnabled = s.failClosed == true
                }
            }
        }
    }

    // MARK: - Connection Actions

    private func setupClaudeCode() {
        Task {
            do {
                _ = try await api.setupClaudeCode()
                await MainActor.run { ccHooksInstalled = true; ccSetupMessage = "✓ " + L.t("settings.hooksInstalled", "Claude Code") }
            } catch { await MainActor.run { ccSetupMessage = L.t("settings.failed", error.localizedDescription) } }
        }
    }

    private func uninstallClaudeCode() {
        Task {
            do {
                _ = try await api.uninstallClaudeCode()
                await MainActor.run { ccHooksInstalled = false; ccSetupMessage = L.t("settings.hooksRemoved", "Claude Code") }
            } catch { await MainActor.run { ccSetupMessage = L.t("settings.failed", error.localizedDescription) } }
        }
    }

    private func setupOpenClaw() {
        Task {
            do {
                _ = try await api.setupOpenClaw()
                await MainActor.run { ocPluginInstalled = true; ocSetupMessage = "✓ " + L.t("settings.pluginInstalled", "OpenClaw") }
            } catch { await MainActor.run { ocSetupMessage = L.t("settings.failed", error.localizedDescription) } }
        }
    }

    private func uninstallOpenClaw() {
        Task {
            do {
                _ = try await api.uninstallOpenClaw()
                await MainActor.run { ocPluginInstalled = false; ocSetupMessage = L.t("settings.pluginRemoved", "OpenClaw") }
            } catch { await MainActor.run { ocSetupMessage = L.t("settings.failed", error.localizedDescription) } }
        }
    }

    private func setupGeminiCLI() {
        Task {
            do {
                _ = try await api.setupGeminiCLI()
                await MainActor.run { geminiInstalled = true; geminiMessage = "✓ " + L.t("settings.hooksInstalled", "Gemini CLI") }
            } catch { await MainActor.run { geminiMessage = L.t("settings.failed", error.localizedDescription) } }
        }
    }

    private func uninstallGeminiCLI() {
        Task {
            do {
                _ = try await api.uninstallGeminiCLI()
                await MainActor.run { geminiInstalled = false; geminiMessage = L.t("settings.hooksRemoved", "Gemini CLI") }
            } catch { await MainActor.run { geminiMessage = L.t("settings.failed", error.localizedDescription) } }
        }
    }

    private func setupCopilot() {
        Task {
            do {
                _ = try await api.setupCopilot()
                await MainActor.run { copilotInstalled = true; copilotMessage = "✓ " + L.t("settings.extensionInstalled", "Copilot CLI") }
            } catch { await MainActor.run { copilotMessage = L.t("settings.failed", error.localizedDescription) } }
        }
    }

    private func uninstallCopilot() {
        Task {
            do {
                _ = try await api.uninstallCopilot()
                await MainActor.run { copilotInstalled = false; copilotMessage = L.t("settings.extensionRemoved", "Copilot CLI") }
            } catch { await MainActor.run { copilotMessage = L.t("settings.failed", error.localizedDescription) } }
        }
    }

    private func setupCursor() {
        Task {
            do {
                _ = try await api.setupCursor()
                await MainActor.run { cursorInstalled = true; cursorMessage = "✓ " + L.t("settings.hooksInstalled", "Cursor") }
            } catch { await MainActor.run { cursorMessage = L.t("settings.failed", error.localizedDescription) } }
        }
    }

    private func uninstallCursor() {
        Task {
            do {
                _ = try await api.uninstallCursor()
                await MainActor.run { cursorInstalled = false; cursorMessage = L.t("settings.hooksRemoved", "Cursor") }
            } catch { await MainActor.run { cursorMessage = L.t("settings.failed", error.localizedDescription) } }
        }
    }
}

// MARK: - Protection Section

private struct ProtectionSection: View {
    @Binding var blockingEnabled: Bool
    @Binding var failClosedEnabled: Bool
    let api: GuardClawAPI
    private var L: Loc { Loc.shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L.t("settings.protection"))
                .font(.caption).foregroundStyle(.secondary)

            HStack {
                Toggle(isOn: Binding(
                    get: { blockingEnabled },
                    set: { val in
                        let prev = blockingEnabled; blockingEnabled = val
                        Task { do { _ = try await api.toggleBlocking(enabled: val) } catch { blockingEnabled = prev } }
                    }
                )) {
                    Text(L.t("settings.activeBlocking")).font(.caption)
                }
                .toggleStyle(.switch).controlSize(.mini)
            }
            Text(blockingEnabled ? L.t("settings.blockingOn") : L.t("settings.blockingOff"))
                .font(.system(size: 9)).foregroundStyle(.secondary)

            HStack {
                Toggle(isOn: Binding(
                    get: { failClosedEnabled },
                    set: { val in Task { _ = try? await api.toggleFailClosed(enabled: val); failClosedEnabled = val } }
                )) {
                    Text(L.t("settings.failClosed")).font(.caption)
                }
                .toggleStyle(.switch).controlSize(.mini)
            }
            Text(failClosedEnabled ? L.t("settings.failClosedOn") : L.t("settings.failClosedOff"))
                .font(.system(size: 9))
                .foregroundStyle(failClosedEnabled ? Color.secondary : Color.orange)
        }
    }
}

// MARK: - Cloud Judge Section (Bar — mode only, no provider setup)

private struct CloudJudgeSection: View {
    @Binding var config: CloudJudgeConfig?
    let api: GuardClawAPI
    @State private var enabled: Bool = false

    private var L: Loc { Loc.shared }
    private var currentMode: String { config?.judgeMode ?? "mixed" }
    private var modeDescription: String {
        switch currentMode {
        case "local-only": return L.t("judge.modeLocalDesc")
        case "cloud-only": return L.t("judge.modeCloudDesc")
        default: return L.t("judge.modeHybridDesc")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Judge Mode")
                .font(.caption).foregroundStyle(.secondary)

            Picker("", selection: Binding(
                get: { currentMode },
                set: { mode in
                    Task {
                        _ = try? await api.updateCloudJudge(judgeMode: mode)
                        await refreshConfig()
                    }
                }
            )) {
                Text(L.t("judge.modeLocal")).tag("local-only")
                Text(L.t("judge.modeHybrid")).tag("mixed")
                Text(L.t("judge.modeCloud")).tag("cloud-only")
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(modeDescription)
                .font(.system(size: 9)).foregroundStyle(.secondary)

            Text("Configure providers in Dashboard → Judge → Cloud")
                .font(.system(size: 9)).foregroundStyle(.tertiary)
        }
        .onAppear { enabled = config?.enabled ?? false }
    }

    private func refreshConfig() async {
        if let cfg = try? await api.cloudJudgeConfig() {
            await MainActor.run { config = cfg }
        }
    }
}
