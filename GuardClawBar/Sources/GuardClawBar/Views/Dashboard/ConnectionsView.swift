import SwiftUI

struct ConnectionsView: View {
    @State private var ccInstalled: Bool? = nil
    @State private var ccMessage: String? = nil
    @State private var ocConnected = false
    @State private var gatewayToken = ""
    @State private var tokenMessage: String? = nil
    @State private var isSavingToken = false

    private let api = GuardClawAPI()
    private let timer = Timer.publish(every: 3, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Claude Code
                claudeCodeSection

                Divider()

                // OpenClaw
                openClawSection
            }
            .padding(24)
        }
        .navigationTitle("Connections")
        .onAppear { refresh() }
        .onReceive(timer) { _ in refresh() }
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
                Label("Hooks are active. Restart Claude Code to pick up any changes.", systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.green)
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
                    .foregroundStyle(msg.contains("✓") ? .green : .red)
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

            Text("Paste your OpenClaw gateway token to enable real-time interception for OpenClaw agents.")
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
                    .foregroundStyle(msg.contains("✓") ? .green : .secondary)
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Actions

    private func refresh() {
        Task {
            if let status = try? await api.claudeCodeStatus() {
                ccInstalled = status.installed
            }
            if let s = try? await api.status() {
                ocConnected = s.backends?["openclaw"]?.connected == true
            }
        }
    }

    private func setupCC() async {
        do {
            _ = try await api.setupClaudeCode()
            ccInstalled = true
            ccMessage = "✓ Hooks installed — restart Claude Code to activate"
        } catch {
            ccMessage = "Failed: \(error.localizedDescription)"
        }
    }

    private func detectToken() async {
        do {
            let resp = try await api.detectToken()
            if let t = resp.token {
                gatewayToken = t
                tokenMessage = "✓ Auto-detected from OpenClaw config"
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
            tokenMessage = "✓ Token saved, reconnecting..."
        } catch {
            tokenMessage = "Failed: \(error.localizedDescription)"
        }
        isSavingToken = false
    }
}
