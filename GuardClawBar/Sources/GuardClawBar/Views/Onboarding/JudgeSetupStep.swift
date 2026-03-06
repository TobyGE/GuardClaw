import SwiftUI

struct JudgeSetupStep: View {
    @State private var selectedBackend = "built-in"
    @State private var models: [BuiltinModel] = []
    @State private var isLoadingModels = false
    @State private var statusMessage: String? = nil

    private let api = GuardClawAPI()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(spacing: 6) {
                    Text("Choose Your Safety Judge")
                        .font(.title2)
                        .fontWeight(.bold)
                    Text("The judge analyzes tool calls and assigns risk scores 1–10.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)

                // Backend cards
                HStack(spacing: 12) {
                    BackendCard(
                        id: "built-in",
                        title: "Built-in",
                        subtitle: "Runs locally on Apple Silicon via MLX",
                        icon: "cpu.fill",
                        recommended: true,
                        isSelected: selectedBackend == "built-in"
                    ) { selectedBackend = "built-in" }

                    BackendCard(
                        id: "lmstudio",
                        title: "LM Studio",
                        subtitle: "Requires LM Studio running on port 1234",
                        icon: "desktopcomputer",
                        recommended: false,
                        isSelected: selectedBackend == "lmstudio"
                    ) { selectedBackend = "lmstudio" }

                    BackendCard(
                        id: "ollama",
                        title: "Ollama",
                        subtitle: "Requires Ollama running on port 11434",
                        icon: "server.rack",
                        recommended: false,
                        isSelected: selectedBackend == "ollama"
                    ) { selectedBackend = "ollama" }
                }

                // Built-in: model list
                if selectedBackend == "built-in" {
                    VStack(alignment: .leading, spacing: 8) {
                        if isLoadingModels {
                            HStack { ProgressView().controlSize(.small); Text("Loading models...").font(.caption) }
                        }
                        ForEach(models) { model in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(model.name).font(.caption).fontWeight(.medium)
                                    Text(model.size).font(.caption2).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if model.loaded {
                                    Label("Active", systemImage: "checkmark.circle.fill").foregroundStyle(.green).font(.caption)
                                } else if model.downloading {
                                    ProgressView().controlSize(.small)
                                } else {
                                    Button("Setup & Run") {
                                        Task { _ = try? await api.setupModel(id: model.id); loadModels() }
                                    }.controlSize(.small)
                                }
                            }
                            .padding(8)
                            .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
                        }
                    }
                    .onAppear { loadModels() }
                }

                if let msg = statusMessage {
                    Text(msg).font(.caption).foregroundStyle(msg.contains("✓") ? .green : .orange)
                }
            }
            .padding(24)
        }
    }

    private func loadModels() {
        isLoadingModels = true
        Task {
            if let resp = try? await api.listModels() {
                models = resp.models
            }
            isLoadingModels = false
        }
    }
}

struct BackendCard: View {
    let id: String
    let title: String
    let subtitle: String
    let icon: String
    let recommended: Bool
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.title2)
                    .foregroundStyle(isSelected ? .white : .secondary)
                Text(title).font(.caption).fontWeight(.semibold)
                    .foregroundStyle(isSelected ? .white : .primary)
                Text(subtitle).font(.system(size: 9)).foregroundStyle(isSelected ? .white.opacity(0.8) : .secondary)
                    .multilineTextAlignment(.center)
                if recommended {
                    Text("RECOMMENDED").font(.system(size: 8, weight: .bold))
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(.orange.opacity(isSelected ? 0.4 : 0.2))
                        .foregroundStyle(isSelected ? .white : .orange)
                        .clipShape(Capsule())
                }
            }
            .frame(maxWidth: .infinity)
            .padding(12)
            .background(isSelected ? AnyShapeStyle(Color.blue) : AnyShapeStyle(Color.primary.opacity(0.06)), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(isSelected ? Color.blue : Color.gray.opacity(0.2), lineWidth: 1.5))
        }
        .buttonStyle(.plain)
    }
}
