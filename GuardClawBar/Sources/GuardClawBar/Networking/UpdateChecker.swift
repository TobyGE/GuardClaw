import Foundation
import AppKit

actor UpdateChecker {
    static let shared = UpdateChecker()

    private let currentVersion = "1.0.4"
    private let releasesURL = URL(string: "https://api.github.com/repos/TobyGE/GuardClaw/releases/latest")!

    struct GitHubRelease: Decodable {
        let tag_name: String
        let html_url: String
    }

    enum UpdateResult: Sendable {
        case upToDate
        case newVersion(version: String, url: String)
        case error(String)
    }

    func check() async -> UpdateResult {
        do {
            var request = URLRequest(url: releasesURL)
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.timeoutInterval = 10

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return .error("GitHub API returned non-200")
            }

            let release = try JSONDecoder().decode(GitHubRelease.self, from: data)
            let latest = release.tag_name.trimmingCharacters(in: CharacterSet(charactersIn: "v"))

            if isNewer(latest, than: currentVersion) {
                return .newVersion(version: release.tag_name, url: release.html_url)
            } else {
                return .upToDate
            }
        } catch {
            return .error(error.localizedDescription)
        }
    }

    private func isNewer(_ remote: String, than local: String) -> Bool {
        let r = remote.split(separator: ".").compactMap { Int($0) }
        let l = local.split(separator: ".").compactMap { Int($0) }
        for i in 0..<max(r.count, l.count) {
            let rv = i < r.count ? r[i] : 0
            let lv = i < l.count ? l[i] : 0
            if rv > lv { return true }
            if rv < lv { return false }
        }
        return false
    }
}
