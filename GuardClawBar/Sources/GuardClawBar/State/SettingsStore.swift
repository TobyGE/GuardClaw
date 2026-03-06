import Foundation

final class SettingsStore: @unchecked Sendable {
    static let shared = SettingsStore()

    private let defaults = UserDefaults.standard

    private enum Keys {
        static let serverURL = "guardclaw.serverURL"
        static let pollInterval = "guardclaw.pollInterval"
        static let hasCompletedOnboarding = "guardclaw.hasCompletedOnboarding"
    }

    var serverURL: String {
        get { defaults.string(forKey: Keys.serverURL) ?? "http://localhost:3002" }
        set { defaults.set(newValue, forKey: Keys.serverURL) }
    }

    var pollInterval: TimeInterval {
        get {
            let val = defaults.double(forKey: Keys.pollInterval)
            return val > 0 ? val : 5.0
        }
        set { defaults.set(newValue, forKey: Keys.pollInterval) }
    }

    var hasCompletedOnboarding: Bool {
        get { defaults.bool(forKey: Keys.hasCompletedOnboarding) }
        set { defaults.set(newValue, forKey: Keys.hasCompletedOnboarding) }
    }

    private init() {}
}
