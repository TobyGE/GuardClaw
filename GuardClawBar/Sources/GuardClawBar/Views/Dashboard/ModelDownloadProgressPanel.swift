import SwiftUI
import AppKit

// MARK: - Panel Window Controller

class ModelDownloadPanelController: NSWindowController {
    private let modelId: String
    private let modelName: String

    init(modelId: String, modelName: String) {
        self.modelId = modelId
        self.modelName = modelName

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 110),
            styleMask: [.titled, .closable, .fullSizeContentView, .nonactivatingPanel, .hudWindow],
            backing: .buffered,
            defer: false
        )
        panel.title = ""
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true

        super.init(window: panel)

        let contentView = ModelDownloadProgressView(modelId: modelId, modelName: modelName) {
            panel.close()
        }
        panel.contentViewController = NSHostingController(rootView: contentView)

        // Position: bottom-right of screen
        if let screen = NSScreen.main {
            let x = screen.visibleFrame.maxX - 380
            let y = screen.visibleFrame.minY + 24
            panel.setFrameOrigin(NSPoint(x: x, y: y))
        }
    }

    required init?(coder: NSCoder) { fatalError() }
}

// MARK: - Progress View

struct ModelDownloadProgressView: View {
    let modelId: String
    let modelName: String
    let onDismiss: () -> Void

    private var L: Loc { Loc.shared }
    @State private var progress: Double = 0
    @State private var phase: DownloadPhase = .starting
    @State private var statusText = Loc.shared.t("download.preparing")
    @State private var pollTimer: Timer?
    @State private var initiallyDownloaded: Bool? = nil  // nil = not yet checked

    private let api = GuardClawAPI()

    enum DownloadPhase { case starting, downloading, downloaded, loading, ready, failed }

    var body: some View {
        HStack(spacing: 14) {
            // Icon
            ZStack {
                Circle()
                    .fill(iconColor.opacity(0.15))
                    .frame(width: 42, height: 42)
                Image(systemName: iconName)
                    .font(.system(size: 19))
                    .foregroundStyle(iconColor)
            }

            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(titleText)
                            .font(.system(size: 12, weight: .semibold))
                            .lineLimit(1)
                        Text(statusText)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    Button {
                        pollTimer?.invalidate()
                        onDismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }

                switch phase {
                case .downloading:
                    ProgressView(value: progress, total: 100)
                        .progressViewStyle(.linear)
                        .tint(.blue)
                case .starting, .loading:
                    ProgressView()
                        .progressViewStyle(.linear)
                        .tint(phase == .loading ? .orange : .secondary)
                case .downloaded, .ready:
                    ProgressView(value: 1, total: 1)
                        .progressViewStyle(.linear)
                        .tint(.green)
                case .failed:
                    ProgressView(value: 0, total: 1)
                        .progressViewStyle(.linear)
                        .tint(.red)
                }
            }
        }
        .padding(16)
        .frame(width: 360, height: 90)
        .onAppear { startPolling() }
        .onDisappear { pollTimer?.invalidate() }
    }

    private var iconName: String {
        switch phase {
        case .starting:    return "arrow.down.circle"
        case .downloading: return "arrow.down.circle.fill"
        case .downloaded:  return "checkmark.circle.fill"
        case .loading:     return "cpu.fill"
        case .ready:       return "checkmark.circle.fill"
        case .failed:      return "exclamationmark.circle.fill"
        }
    }

    private var iconColor: Color {
        switch phase {
        case .starting, .downloading: return .blue
        case .downloaded, .ready:     return .green
        case .loading:                return .orange
        case .failed:                 return .red
        }
    }

    private var titleText: String {
        switch phase {
        case .starting:    return L.t("download.settingUp", modelName)
        case .downloading: return L.t("download.downloading", modelName)
        case .downloaded:  return L.t("download.downloaded", modelName)
        case .loading:     return L.t("download.loadingModel", modelName)
        case .ready:       return L.t("download.ready", modelName)
        case .failed:      return L.t("download.setupFailed")
        }
    }

    private func startPolling() {
        pollTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            Task { await poll() }
        }
        Task { await poll() }
    }

    private func poll() async {
        guard let resp = try? await api.listModels(),
              let model = resp.models.first(where: { $0.id == modelId }) else { return }

        await MainActor.run {
            // Record the initial downloaded state on first poll
            let wasAlreadyDownloaded = initiallyDownloaded ?? model.downloaded
            if initiallyDownloaded == nil { initiallyDownloaded = model.downloaded }

            if model.downloaded && !model.downloading && phase != .downloaded {
                if wasAlreadyDownloaded {
                    // Already downloaded before this session — just close silently
                    pollTimer?.invalidate()
                    onDismiss()
                } else {
                    // Fresh download just completed — notify
                    phase = .downloaded
                    statusText = L.t("download.openJudge")
                    pollTimer?.invalidate()
                    NotificationManager().notifyModelDownloaded(modelName: modelName)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) { onDismiss() }
                }
            } else if model.downloading {
                phase = .downloading
                progress = Double(model.progress)
                statusText = L.t("download.progress", model.progress)
            } else if let err = model.setupError {
                phase = .failed
                statusText = err
                pollTimer?.invalidate()
            } else {
                phase = .starting
                statusText = L.t("download.preparingDownload")
            }
        }
    }
}
