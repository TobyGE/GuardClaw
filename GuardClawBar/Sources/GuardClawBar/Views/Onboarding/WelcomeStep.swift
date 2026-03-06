import SwiftUI

struct WelcomeStep: View {
    var body: some View {
        VStack(spacing: 24) {
            Image(nsImage: IconRenderer.render(status: .normal, badgeCount: 0))
                .resizable()
                .frame(width: 72, height: 72)

            VStack(spacing: 8) {
                Text("Welcome to GuardClaw")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                Text("AI agent safety, in real time")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 12) {
                FeatureRow(icon: "shield.checkered", color: .blue, text: "Risk-scores every tool call your AI agent makes")
                FeatureRow(icon: "xmark.shield", color: .red, text: "Blocks dangerous operations automatically")
                FeatureRow(icon: "brain", color: .purple, text: "Learns from your approve/deny decisions")
            }
            .padding(.horizontal, 40)
        }
        .padding()
    }
}

struct FeatureRow: View {
    let icon: String
    let color: Color
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(color)
                .frame(width: 32)
            Text(text)
                .font(.body)
        }
    }
}
