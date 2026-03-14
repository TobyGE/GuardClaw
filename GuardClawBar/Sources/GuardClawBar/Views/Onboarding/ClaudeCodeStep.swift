import SwiftUI

struct ClaudeCodeStep: View {
    private var L: Loc { Loc.shared }
    @State private var installed: Bool? = nil
    @State private var message: String? = nil
    @State private var isInstalling = false

    private let api = GuardClawAPI()

    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 6) {
                Text(L.t("ccStep.title"))
                    .font(.title2)
                    .fontWeight(.bold)
                Text(L.t("ccStep.subtitle"))
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
                Text(installed == true ? L.t("ccStep.installed") : L.t("ccStep.notInstalled"))
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
                        Label(L.t("ccStep.installHooks"), systemImage: "plus.circle.fill")
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

            Text(L.t("ccStep.afterInstall"))
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
            message = "✓ " + L.t("ccStep.installSuccess")
        } catch {
            message = "Failed: \(error.localizedDescription)"
        }
        isInstalling = false
    }
}
