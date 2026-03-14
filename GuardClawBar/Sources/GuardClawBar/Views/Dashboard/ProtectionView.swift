import SwiftUI

struct ProtectionView: View {
    @Environment(AppState.self) var appState
    @State private var statusMessage: String? = nil
    @State private var blockingOverride: Bool? = nil
    private var L: Loc { Loc.shared }

    private let api = GuardClawAPI()

    private var blockingEnabled: Bool {
        blockingOverride ?? appState.serverStatus?.blocking?.active ?? appState.serverStatus?.blocking?.enabled ?? false
    }

    private var failClosed: Bool {
        appState.serverStatus?.failClosed == true
    }

    private var failClosedDetailTitle: String {
        failClosed ? L.t("protection.failOpenRemoved") : L.t("protection.failOpenActive")
    }

    private var failClosedDetailBody: String {
        failClosed
            ? L.t("protection.failClosedDetail")
            : L.t("protection.failOpenDetail")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Active Blocking Card
                protectionCard(
                    title: L.t("protection.activeBlocking"),
                    icon: "shield.slash",
                    description: blockingEnabled
                        ? L.t("protection.blockingOnDesc")
                        : L.t("protection.blockingOffDesc"),
                    color: blockingEnabled ? .green : .orange,
                    isOn: blockingEnabled,
                    onToggle: toggleBlocking
                )

                // Fail-Closed Card
                protectionCard(
                    title: L.t("protection.failClosedOffline"),
                    icon: "lock.fill",
                    description: failClosed
                        ? L.t("protection.failClosedOnDesc")
                        : L.t("protection.failClosedOffDesc"),
                    color: failClosed ? .blue : .gray,
                    isOn: failClosed,
                    onToggle: toggleFailClosed
                )

                GroupBox {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(failClosedDetailTitle)
                            .font(.caption)
                            .fontWeight(.semibold)
                        Text(failClosedDetailBody)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } label: {
                    Label(L.t("protection.offlineJudgeBehavior"), systemImage: failClosed ? "checkmark.shield" : "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(failClosed ? Color.secondary : Color.orange)
                }

                if let msg = statusMessage {
                    Text(msg)
                        .font(.caption)
                        .foregroundStyle(msg.contains("\u{2713}") ? .green : .orange)
                }

                // Explanation
                GroupBox {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(L.t("protection.strict"), systemImage: "shield.checkered").font(.caption).fontWeight(.semibold)
                        Text(L.t("protection.strictDesc"))
                            .font(.caption2).foregroundStyle(.secondary)
                        Divider()
                        Label(L.t("protection.balanced"), systemImage: "shield.lefthalf.filled").font(.caption).fontWeight(.semibold)
                        Text(L.t("protection.balancedDesc"))
                            .font(.caption2).foregroundStyle(.secondary)
                        Divider()
                        Label(L.t("protection.monitorOnly"), systemImage: "eye").font(.caption).fontWeight(.semibold)
                        Text(L.t("protection.monitorOnlyDesc"))
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                } label: {
                    Text(L.t("protection.presets")).font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(24)
        }
        .navigationTitle(L.t("protection.title"))
        .onAppear {
            blockingOverride = appState.serverStatus?.blocking?.active ?? appState.serverStatus?.blocking?.enabled
        }
        .onChange(of: appState.serverStatus?.blocking?.active ?? appState.serverStatus?.blocking?.enabled ?? false) { _, newVal in
            blockingOverride = newVal
        }
    }

    private func protectionCard(title: String, icon: String, description: String, color: Color, isOn: Bool, onToggle: @escaping (Bool) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(title, systemImage: icon)
                    .font(.headline)
                Spacer()
                Toggle("", isOn: Binding(
                    get: { isOn },
                    set: { onToggle($0) }
                ))
                .toggleStyle(.switch)
            }
            Text(description)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(color.opacity(isOn ? 0.4 : 0.1), lineWidth: 1.5)
        )
    }

    private func toggleBlocking(_ newVal: Bool) {
        let previousVal = blockingEnabled
        blockingOverride = newVal
        Task {
            do {
                _ = try await api.toggleBlocking(enabled: newVal)
                statusMessage = "\u{2713} " + (newVal ? L.t("protection.blockingEnabled") : L.t("protection.blockingDisabled"))
            } catch {
                blockingOverride = previousVal
                statusMessage = L.t("settings.failed", error.localizedDescription)
            }
        }
    }

    private func toggleFailClosed(_ newVal: Bool) {
        Task {
            do {
                _ = try await api.toggleFailClosed(enabled: newVal)
                statusMessage = newVal
                    ? "\u{2713} " + L.t("protection.failClosedEnabled")
                    : L.t("protection.failClosedDisabled")
            } catch {
                statusMessage = L.t("settings.failed", error.localizedDescription)
            }
        }
    }
}
