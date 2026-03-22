import SwiftUI

struct WelcomeStep: View {
    private var L: Loc { Loc.shared }
    @State private var glow = false

    var body: some View {
        VStack(spacing: 0) {
            // Hero
            ZStack {
                LinearGradient(
                    colors: [Color.blue.opacity(0.12), Color.purple.opacity(0.08), Color.clear],
                    startPoint: .top,
                    endPoint: .bottom
                )

                VStack(spacing: 20) {
                    ZStack {
                        Circle()
                            .fill(Color.blue.opacity(0.15))
                            .frame(width: 120, height: 120)
                            .blur(radius: 24)
                            .scaleEffect(glow ? 1.15 : 1.0)
                            .animation(.easeInOut(duration: 2.5).repeatCount(5, autoreverses: true), value: glow)

                        Image(nsImage: IconRenderer.render(status: .normal, badgeCount: 0))
                            .resizable()
                            .frame(width: 84, height: 84)
                            .scaleEffect(glow ? 1.03 : 1.0)
                            .animation(.easeInOut(duration: 2.5).repeatCount(5, autoreverses: true), value: glow)
                    }

                    VStack(spacing: 6) {
                        Text(L.t("header.title"))
                            .font(.system(size: 38, weight: .bold, design: .rounded))
                        Text(L.t("welcome.tagline"))
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(height: 280)

            // Features
            VStack(alignment: .leading, spacing: 11) {
                FeatureRow(icon: "waveform.and.magnifyingglass", color: .blue,
                           text: L.t("welcome.feature1"))
                FeatureRow(icon: "xmark.shield.fill", color: .red,
                           text: L.t("welcome.feature2"))
                FeatureRow(icon: "brain.head.profile", color: .purple,
                           text: L.t("welcome.feature3"))
            }
            .padding(.horizontal, 64)
            .padding(.bottom, 20)
        }
        .onAppear { glow = true }
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
