import SwiftUI

struct OnboardingView: View {
    @Binding var isPresented: Bool
    @State private var currentStep = 0

    private let totalSteps = 5

    var body: some View {
        VStack(spacing: 0) {
            // Step indicator
            HStack(spacing: 8) {
                ForEach(0..<totalSteps, id: \.self) { i in
                    Circle()
                        .fill(i == currentStep ? Color.blue : i < currentStep ? Color.green : Color.secondary.opacity(0.3))
                        .frame(width: 8, height: 8)
                }
            }
            .padding(.top, 24)
            .padding(.bottom, 16)

            // Content
            Group {
                switch currentStep {
                case 0: WelcomeStep()
                case 1: JudgeSetupStep()
                case 2: ClaudeCodeStep()
                case 3: SecurityScanStep()
                case 4: ProtectionStep(onFinish: finish)
                default: EmptyView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            Divider()

            // Navigation buttons
            HStack {
                if currentStep > 0 {
                    Button("Back") { withAnimation { currentStep -= 1 } }
                        .buttonStyle(.bordered)
                }

                Spacer()

                if currentStep < totalSteps - 1 {
                    Button("Skip") { withAnimation { currentStep += 1 } }
                        .foregroundStyle(.secondary)

                    Button(currentStep == 0 ? "Get Started" : "Next") {
                        withAnimation { currentStep += 1 }
                    }
                    .buttonStyle(.borderedProminent)
                }
                // "Finish" button is inside ProtectionStep for step 4
            }
            .padding(20)
        }
        .frame(width: 600, height: 520)
    }

    private func finish() {
        SettingsStore.shared.hasCompletedOnboarding = true
        isPresented = false
    }
}
