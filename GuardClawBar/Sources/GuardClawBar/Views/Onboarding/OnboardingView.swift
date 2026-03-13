import SwiftUI

extension Notification.Name {
    static let guardclawModelSetupStarted = Notification.Name("guardclaw.modelSetupStarted")
}

struct OnboardingView: View {
    @Binding var isPresented: Bool
    @State private var currentStep = 0

    private let totalSteps = 4

    var body: some View {
        VStack(spacing: 0) {
            // Step indicator
            HStack(spacing: 8) {
                ForEach(0..<totalSteps, id: \.self) { i in
                    Circle()
                        .fill(i == currentStep ? Color.blue : i < currentStep ? Color.green : Color.secondary.opacity(0.3))
                        .frame(width: 8, height: 8)
                        .animation(.easeInOut, value: currentStep)
                }
            }
            .padding(.top, 24)
            .padding(.bottom, 16)

            // Content
            Group {
                switch currentStep {
                case 0: WelcomeStep()
                case 1: FeatureTourStep()
                case 2: ClaudeCodeStep()
                case 3: ModelSelectionStep(onFinish: finish)
                default: EmptyView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            Divider()

            // Navigation — last step has its own Finish button
            if currentStep < totalSteps - 1 {
                HStack {
                    if currentStep > 0 {
                        Button("Back") { withAnimation { currentStep -= 1 } }
                            .buttonStyle(.bordered)
                    }
                    Spacer()
                    Button("Skip") { withAnimation { currentStep += 1 } }
                        .foregroundStyle(.secondary)
                    Button(currentStep == 0 ? "Get Started" : "Next") {
                        withAnimation { currentStep += 1 }
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(20)
            } else {
                HStack {
                    Button("Back") { withAnimation { currentStep -= 1 } }
                        .buttonStyle(.bordered)
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            }
        }
        .frame(width: 640, height: 560)
    }

    private func finish(backend: String, modelId: String?) {
        SettingsStore.shared.selectedBackend = backend
        SettingsStore.shared.selectedModelId = modelId
        SettingsStore.shared.hasCompletedOnboarding = true

        if backend == "built-in", let modelId = modelId {
            Task {
                let api = GuardClawAPI()
                _ = try? await api.downloadModel(id: modelId)
            }
            // Post after a short delay so the download API call fires first
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                NotificationCenter.default.post(
                    name: .guardclawModelSetupStarted,
                    object: modelId
                )
            }
        }

        isPresented = false
    }
}
