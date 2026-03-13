import SwiftUI

struct ModelSelectionStep: View {
    let onFinish: (String, String?) -> Void

    @State private var selectedBackend = "built-in"
    @State private var selectedModelId: String? = nil
    @State private var models: [BuiltinModel] = []
    @State private var isLoadingModels = false
    @State private var isFinishing = false

    private let api = GuardClawAPI()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(spacing: 6) {
                    Text("Choose Your Safety Judge")
                        .font(.title2).fontWeight(.bold)
                    Text("The judge analyzes every tool call and assigns a risk score.\nYou can change this anytime in settings.")
                        .font(.subheadline).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)

                // Backend cards
                HStack(spacing: 12) {
                    BackendCard(
                        id: "built-in", title: "Built-in",
                        subtitle: "Runs locally on Apple Silicon via MLX",
                        icon: "cpu.fill", recommended: true,
                        isSelected: selectedBackend == "built-in"
                    ) { selectedBackend = "built-in" }

                    BackendCard(
                        id: "lmstudio", title: "LM Studio",
                        subtitle: "Requires LM Studio running on port 1234",
                        icon: "desktopcomputer", recommended: false,
                        isSelected: selectedBackend == "lmstudio"
                    ) { selectedBackend = "lmstudio" }

                    BackendCard(
                        id: "ollama", title: "Ollama",
                        subtitle: "Requires Ollama running on port 11434",
                        icon: "server.rack", recommended: false,
                        isSelected: selectedBackend == "ollama"
                    ) { selectedBackend = "ollama" }
                }

                // Built-in model picker
                if selectedBackend == "built-in" {
                    VStack(alignment: .leading, spacing: 8) {
                        if isLoadingModels {
                            HStack {
                                ProgressView().controlSize(.small)
                                Text("Loading models...").font(.caption).foregroundStyle(.secondary)
                            }
                        }

                        ForEach(models) { model in
                            Button { selectedModelId = model.id } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: selectedModelId == model.id
                                          ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(selectedModelId == model.id ? Color.blue : Color.secondary)
                                        .font(.system(size: 16))

                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(model.name).font(.caption).fontWeight(.medium)
                                        Text(model.size).font(.caption2).foregroundStyle(.secondary)
                                    }

                                    Spacer()

                                    if model.downloaded {
                                        Label("Already downloaded", systemImage: "checkmark.circle")
                                            .font(.caption2).foregroundStyle(.green)
                                    }
                                }
                                .padding(10)
                                .background(
                                    selectedModelId == model.id
                                        ? Color.blue.opacity(0.08)
                                        : Color.primary.opacity(0.04),
                                    in: RoundedRectangle(cornerRadius: 8)
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(selectedModelId == model.id
                                                ? Color.blue.opacity(0.35) : Color.clear,
                                                lineWidth: 1.5)
                                )
                            }
                            .buttonStyle(.plain)
                        }

                        // Download note
                        if selectedModelId != nil {
                            HStack(spacing: 6) {
                                Image(systemName: "arrow.down.circle")
                                    .font(.caption2).foregroundStyle(.secondary)
                                Text("Download starts in the background once you enter the app. A progress panel will appear.")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                            .padding(.top, 2)
                        }
                    }
                    .onAppear { loadModels() }

                } else {
                    // External backend info
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "info.circle")
                            .foregroundStyle(.secondary).font(.caption)
                            .padding(.top, 1)
                        Text(selectedBackend == "lmstudio"
                             ? "Make sure LM Studio is running at http://localhost:1234 with a model loaded."
                             : "Make sure Ollama is running at http://localhost:11434 with a model loaded.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(10)
                    .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }

                // Finish button
                Button {
                    isFinishing = true
                    onFinish(selectedBackend, selectedModelId)
                } label: {
                    Group {
                        if isFinishing {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Start GuardClaw")
                                .frame(maxWidth: .infinity)
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(isFinishing || (selectedBackend == "built-in" && selectedModelId == nil))
                .padding(.top, 4)
            }
            .padding(24)
        }
    }

    private func loadModels() {
        isLoadingModels = true
        Task {
            if let resp = try? await api.listModels() {
                models = resp.models
                if selectedModelId == nil, let first = models.first {
                    selectedModelId = first.id
                }
            }
            isLoadingModels = false
        }
    }
}
