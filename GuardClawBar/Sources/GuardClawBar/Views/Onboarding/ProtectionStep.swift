import SwiftUI

struct ProtectionStep: View {
    let onFinish: () -> Void
    @State private var selectedLevel = "strict"
    @State private var isApplying = false

    private let api = GuardClawAPI()

    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 6) {
                Text("Choose Protection Level")
                    .font(.title2)
                    .fontWeight(.bold)
                Text("You can change this anytime in the Protection settings.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 10) {
                ProtectionLevelCard(
                    id: "strict",
                    title: "Strict",
                    subtitle: "Active Blocking + Fail-Closed",
                    description: "Recommended. Risky calls require approval, and GuardClaw will not silently fail open when the judge is offline.",
                    icon: "lock.shield.fill",
                    color: .red,
                    isSelected: selectedLevel == "strict"
                ) { selectedLevel = "strict" }

                ProtectionLevelCard(
                    id: "balanced",
                    title: "Balanced",
                    subtitle: "Active Blocking + Fail-Open",
                    description: "Keeps approvals on, but if the judge is offline some risky calls may continue without review.",
                    icon: "shield.lefthalf.filled",
                    color: .blue,
                    isSelected: selectedLevel == "balanced"
                ) { selectedLevel = "balanced" }

                ProtectionLevelCard(
                    id: "monitor",
                    title: "Monitor Only",
                    subtitle: "No blocking, log only",
                    description: "Observe without intervening. Safe for evaluating GuardClaw.",
                    icon: "eye",
                    color: .gray,
                    isSelected: selectedLevel == "monitor"
                ) { selectedLevel = "monitor" }
            }
            .padding(.horizontal, 20)

            Button {
                isApplying = true
                Task { await applyAndFinish() }
            } label: {
                if isApplying {
                    ProgressView().controlSize(.small)
                } else {
                    Text("Finish Setup")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal, 20)
            .disabled(isApplying)
        }
        .padding()
    }

    private func applyAndFinish() async {
        let blocking = selectedLevel != "monitor"
        let failClosed = selectedLevel == "strict"
        _ = try? await api.toggleBlocking(enabled: blocking)
        _ = try? await api.toggleFailClosed(enabled: failClosed)
        isApplying = false
        onFinish()
    }
}

struct ProtectionLevelCard: View {
    let id: String
    let title: String
    let subtitle: String
    let description: String
    let icon: String
    let color: Color
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.title2)
                    .foregroundStyle(isSelected ? color : .secondary)
                    .frame(width: 32)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(title).font(.subheadline).fontWeight(.semibold)
                        Text(subtitle).font(.caption2).foregroundStyle(.secondary)
                    }
                    Text(description).font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(color)
                }
            }
            .padding(12)
            .background(.quaternary.opacity(isSelected ? 0.8 : 0.4), in: RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(isSelected ? color.opacity(0.6) : Color.clear, lineWidth: 1.5)
            )
        }
        .buttonStyle(.plain)
    }
}
