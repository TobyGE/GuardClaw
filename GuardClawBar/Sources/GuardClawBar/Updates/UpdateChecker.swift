import Foundation
import SwiftUI
import AppKit

struct GitHubRelease: Codable {
    let tagName: String
    let htmlUrl: String
    let assets: [GitHubAsset]

    enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case htmlUrl = "html_url"
        case assets
    }
}

struct GitHubAsset: Codable {
    let name: String
    let browserDownloadUrl: String

    enum CodingKeys: String, CodingKey {
        case name
        case browserDownloadUrl = "browser_download_url"
    }
}

enum UpdatePhase: Equatable {
    case idle
    case checking
    case available(version: String, url: String)
    case downloading(progress: Double)
    case installing
    case done
    case error(String)
}

@Observable
@MainActor
final class UpdateChecker {
    var phase: UpdatePhase = .idle

    var updateAvailable: Bool {
        if case .available = phase { return true }
        return false
    }

    var availableVersion: String? {
        if case .available(let v, _) = phase { return v }
        return nil
    }

    var isWorking: Bool {
        switch phase {
        case .checking, .downloading, .installing: return true
        default: return false
        }
    }

    var currentVersion: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0")
            .trimmingCharacters(in: .init(charactersIn: "v"))
    }

    // MARK: - Check

    func checkForUpdates() async {
        guard case .idle = phase else { return }
        phase = .checking

        guard let url = URL(string: "https://api.github.com/repos/TobyGE/GuardClaw/releases/latest") else {
            phase = .idle
            return
        }

        var request = URLRequest(url: url)
        request.setValue("application/vnd.github.v3+json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 10

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            let release = try JSONDecoder().decode(GitHubRelease.self, from: data)
            let tag = release.tagName.trimmingCharacters(in: .init(charactersIn: "v"))

            guard compareVersions(tag, currentVersion) > 0 else {
                phase = .idle
                return
            }

            guard let asset = release.assets.first(where: { $0.name.hasSuffix(".dmg") }) else {
                phase = .idle
                return
            }

            phase = .available(version: release.tagName, url: asset.browserDownloadUrl)
        } catch {
            phase = .idle // silently fail — don't bother the user
        }
    }

    // MARK: - Install

    func downloadAndInstall() async {
        guard case .available(_, let urlStr) = phase,
              let downloadURL = URL(string: urlStr) else { return }

        let tempDir = FileManager.default.temporaryDirectory
        let dmgPath = tempDir.appendingPathComponent("GuardClawBar-update.dmg")

        // Download
        do {
            phase = .downloading(progress: 0)
            let (tempFile, _) = try await URLSession.shared.download(from: downloadURL)
            phase = .downloading(progress: 0.8)
            try? FileManager.default.removeItem(at: dmgPath)
            try FileManager.default.moveItem(at: tempFile, to: dmgPath)
        } catch {
            phase = .error("Download failed: \(error.localizedDescription)")
            return
        }

        // Write installer script — runs after app quits
        phase = .installing
        let scriptPath = tempDir.appendingPathComponent("guardclaw-update.sh")
        let installPath = "/Applications/GuardClawBar.app"

        let script = """
        #!/bin/bash
        sleep 2
        VOLUME=$(hdiutil attach '\(dmgPath.path)' -nobrowse -readonly 2>/dev/null | tail -1 | awk '{print $NF}')
        if [ -z "$VOLUME" ]; then
          osascript -e 'display alert "GuardClaw Update" message "Could not mount update. Please install manually." as warning'
          exit 1
        fi
        rm -rf '\(installPath)'
        ditto "$VOLUME/GuardClawBar.app" '\(installPath)'
        hdiutil detach "$VOLUME" -quiet 2>/dev/null
        rm -f '\(dmgPath.path)'
        open '\(installPath)'
        rm -f '\(scriptPath.path)'
        """

        do {
            try script.write(to: scriptPath, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes(
                [.posixPermissions: NSNumber(value: 0o755)],
                ofItemAtPath: scriptPath.path
            )

            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/bash")
            process.arguments = [scriptPath.path]
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            try process.run()

            // Give the script a moment to launch, then quit
            try await Task.sleep(for: .milliseconds(400))
            NSApp.terminate(nil)
        } catch {
            phase = .error("Install failed: \(error.localizedDescription)")
        }
    }

    func dismiss() {
        phase = .idle
    }

    // MARK: - Helpers

    private func compareVersions(_ a: String, _ b: String) -> Int {
        let aParts = a.split(separator: ".").compactMap { Int($0) }
        let bParts = b.split(separator: ".").compactMap { Int($0) }
        let len = max(aParts.count, bParts.count)
        for i in 0..<len {
            let av = i < aParts.count ? aParts[i] : 0
            let bv = i < bParts.count ? bParts[i] : 0
            if av != bv { return av > bv ? 1 : -1 }
        }
        return 0
    }
}
