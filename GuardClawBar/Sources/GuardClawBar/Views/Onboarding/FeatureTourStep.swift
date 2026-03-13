import SwiftUI

struct FeatureTourStep: View {
    var body: some View {
        VStack(spacing: 20) {
            VStack(spacing: 6) {
                Text("See GuardClaw in Action")
                    .font(.title2).fontWeight(.bold)
                Text("Every tool call your AI agent makes — analyzed, scored, and protected.")
                    .font(.subheadline).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 8)

            HStack(alignment: .top, spacing: 14) {
                FeatureCard(color: .blue, icon: "waveform.and.magnifyingglass",
                            title: "Real-time Analysis",
                            description: "Every tool call gets a risk score 1–10 before it executes") {
                    RiskScoringIllustration()
                }
                FeatureCard(color: .red, icon: "xmark.shield.fill",
                            title: "Auto-blocking",
                            description: "Dangerous commands are intercepted before they can cause harm") {
                    BlockingIllustration()
                }
                FeatureCard(color: .purple, icon: "brain.head.profile",
                            title: "Learns From You",
                            description: "Approve once, and GuardClaw remembers — auto-approving next time") {
                    LearningIllustration()
                }
            }
            .padding(.horizontal, 24)
        }
        .padding(.vertical, 16)
    }
}

// MARK: - Feature Card

struct FeatureCard<Illustration: View>: View {
    let color: Color
    let icon: String
    let title: String
    let description: String
    @ViewBuilder let illustration: () -> Illustration

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                color.opacity(0.07)
                illustration()
                    .padding(14)
            }
            .frame(height: 150)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(color.opacity(0.15), lineWidth: 1))

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 5) {
                    Image(systemName: icon)
                        .font(.caption)
                        .foregroundStyle(color)
                    Text(title)
                        .font(.caption).fontWeight(.semibold)
                }
                Text(description)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 10)
            .padding(.horizontal, 2)
        }
    }
}

// MARK: - Illustrations

struct RiskScoringIllustration: View {
    let rows: [(String, String, Int, Color)] = [
        ("doc.text.fill", "Read config.md", 2, .green),
        ("pencil.and.outline", "Edit main.py", 5, .orange),
        ("terminal.fill", "curl | bash", 9, .red),
    ]

    var body: some View {
        VStack(spacing: 7) {
            ForEach(rows, id: \.1) { icon, name, score, color in
                HStack(spacing: 6) {
                    Image(systemName: icon)
                        .font(.system(size: 10))
                        .foregroundStyle(color)
                        .frame(width: 14)
                    Text(name)
                        .font(.system(size: 9, design: .monospaced))
                        .lineLimit(1)
                    Spacer()
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Color.secondary.opacity(0.15))
                            .frame(width: 36, height: 5)
                        RoundedRectangle(cornerRadius: 2)
                            .fill(color)
                            .frame(width: 36 * CGFloat(score) / 10, height: 5)
                    }
                    Text("\(score)")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(color)
                        .frame(width: 10)
                }
            }
            HStack {
                Spacer()
                Label("BLOCKED", systemImage: "xmark.shield.fill")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(Color.red, in: Capsule())
            }
            .padding(.top, 2)
        }
    }
}

struct BlockingIllustration: View {
    @State private var pulse = false

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 8) {
                Text("rm -rf ~/.ssh")
                    .font(.system(size: 9, design: .monospaced))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 4))
                    .foregroundStyle(.red)

                ZStack {
                    Rectangle()
                        .fill(Color.red.opacity(0.35))
                        .frame(width: 18, height: 1.5)
                    Image(systemName: "xmark")
                        .font(.system(size: 7, weight: .black))
                        .foregroundStyle(.white)
                        .padding(3)
                        .background(Color.red, in: Circle())
                }

                Image(systemName: "xmark.shield.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(.red)
                    .scaleEffect(pulse ? 1.08 : 1.0)
                    .animation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true), value: pulse)
            }

            Text("BLOCKED")
                .font(.system(size: 12, weight: .heavy))
                .foregroundStyle(.red)
                .tracking(2)
        }
        .onAppear { pulse = true }
    }
}

struct LearningIllustration: View {
    var body: some View {
        VStack(spacing: 0) {
            LearningRow(icon: "hand.thumbsup.fill", color: .blue, text: "You approved: git push")
            LearningConnector()
            LearningRow(icon: "brain.fill", color: .purple, text: "Pattern saved")
            LearningConnector()
            LearningRow(icon: "bolt.fill", color: .green, text: "Auto-approved next time")
        }
    }
}

struct LearningRow: View {
    let icon: String
    let color: Color
    let text: String

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: icon)
                .font(.system(size: 10))
                .foregroundStyle(color)
                .frame(width: 18)
            Text(text)
                .font(.system(size: 9))
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 7))
    }
}

struct LearningConnector: View {
    var body: some View {
        Rectangle()
            .fill(Color.secondary.opacity(0.3))
            .frame(width: 1.5, height: 10)
            .padding(.leading, 21)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
