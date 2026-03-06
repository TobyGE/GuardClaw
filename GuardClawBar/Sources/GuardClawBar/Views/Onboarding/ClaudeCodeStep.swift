import SwiftUI

struct ClaudeCodeStep: View {
    @State private var installed: Bool? = nil
    @State private var message: String? = nil
    @State private var isInstalling = false

    private let api = GuardClawAPI()

    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 6) {
                Text("Connect to Claude Code")
                    .font(.title2)
                    .fontWeight(.bold)
                Text("GuardClaw uses Claude Code hooks to intercept tool calls before they run.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }

            // Status
            HStack(spacing: 10) {
                Circle()
                    .fill(installed == true ? Color.green : Color.gray)
                    .frame(width: 14, height: 14)
                Text(installed == true ? "Hooks are installed" : "Hooks not yet installed")
                    .font(.body)
                    .fontWeight(.medium)
            }
            .padding(12)
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))

            if installed != true {
                Button {
                    isInstalling = true
                    Task { await installHooks() }
                } label: {
                    if isInstalling {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Install Hooks", systemImage: "plus.circle.fill")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isInstalling)
            }

            if let msg = message {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(msg.contains("✓") ? .green : .red)
                    .multilineTextAlignment(.center)
            }

            Text("After installing, restart Claude Code for the hooks to activate.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
        .padding()
        .onAppear { checkStatus() }
    }

    private func checkStatus() {
        Task {
            if let s = try? await api.claudeCodeStatus() {
                installed = s.installed
            }
        }
    }

    private func installHooks() async {
        do {
            _ = try await api.setupClaudeCode()
            installed = true
            message = "✓ Hooks installed — restart Claude Code to activate"
        } catch {
            message = "Failed: \(error.localizedDescription)"
        }
        isInstalling = false
    }
}
