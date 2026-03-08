import Foundation

/// Manages the embedded Node.js backend server lifecycle.
/// Priority order:
///   1. Embedded Node.js inside app bundle (production .app)
///   2. System node + source server/index.js (development via swift run)
@MainActor
final class BackendManager: @unchecked Sendable {
    static let shared = BackendManager()

    private var process: Process?
    private var outputPipe: Pipe?
    private let port: Int = 3002
    private var isRunning = false

    private init() {}

    // MARK: - Embedded backend (production)

    private var backendDir: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("backend")
    }

    private var embeddedNode: URL? {
        backendDir?.appendingPathComponent("node")
    }

    private var embeddedServerEntry: URL? {
        backendDir?.appendingPathComponent("server/index.js")
    }

    var hasEmbeddedBackend: Bool {
        guard let node = embeddedNode, let entry = embeddedServerEntry else { return false }
        return FileManager.default.fileExists(atPath: node.path)
            && FileManager.default.fileExists(atPath: entry.path)
    }

    // MARK: - Dev backend (system node + source tree)

    /// Find node binary in common Homebrew / nvm / system locations.
    private var systemNode: URL? {
        let candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
            "\(ProcessInfo.processInfo.environment["HOME"] ?? "")/.nvm/versions/node/\(latestNvmVersion ?? "")/bin/node",
        ]
        for path in candidates where FileManager.default.fileExists(atPath: path) {
            return URL(fileURLWithPath: path)
        }
        // Fall back to `which node`
        return resolveViaWhich("node")
    }

    private var latestNvmVersion: String? {
        let nvmDir = "\(ProcessInfo.processInfo.environment["HOME"] ?? "")/.nvm/versions/node"
        return try? FileManager.default.contentsOfDirectory(atPath: nvmDir)
            .filter { $0.hasPrefix("v") }
            .sorted()
            .last
    }

    /// Walk up from the executable looking for server/index.js (dev tree).
    private var devServerEntry: (node: URL, entry: URL, workDir: URL)? {
        guard let node = systemNode else { return nil }
        var dir = Bundle.main.executableURL?.deletingLastPathComponent()
        for _ in 0..<8 {
            guard let d = dir else { break }
            let candidate = d.appendingPathComponent("server/index.js")
            if FileManager.default.fileExists(atPath: candidate.path) {
                return (node, candidate, d)
            }
            dir = d.deletingLastPathComponent()
        }
        return nil
    }

    // MARK: - Start / Stop

    func start() {
        guard !isRunning else { return }

        if hasEmbeddedBackend {
            guard let node = embeddedNode, let entry = embeddedServerEntry, let dir = backendDir else { return }
            launch(node: node, entry: entry, workDir: dir, mode: "embedded")
        } else if let dev = devServerEntry {
            launch(node: dev.node, entry: dev.entry, workDir: dev.workDir, mode: "dev")
        } else {
            print("[BackendManager] No backend found (no embedded bundle, no system node / server/index.js). Connect to a running server manually.")
        }
    }

    private func launch(node: URL, entry: URL, workDir: URL, mode: String) {
        let proc = Process()
        proc.executableURL = node
        proc.arguments = [entry.path]
        proc.currentDirectoryURL = workDir

        var env = ProcessInfo.processInfo.environment
        env["PORT"] = String(port)
        env["NODE_ENV"] = mode == "embedded" ? "production" : "development"
        if mode == "embedded" {
            let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
                .first!.appendingPathComponent("GuardClawBar")
            try? FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
            env["GUARDCLAW_DATA_DIR"] = appSupport.path
        }
        proc.environment = env

        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = pipe
        outputPipe = pipe

        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                // EOF — process closed stdout, stop reading
                handle.readabilityHandler = nil
                return
            }
            if let str = String(data: data, encoding: .utf8) {
                print("[Backend] \(str.trimmingCharacters(in: .whitespacesAndNewlines))")
            }
        }

        proc.terminationHandler = { [weak self] proc in
            Task { @MainActor in
                self?.isRunning = false
                if proc.terminationStatus != 0 && proc.terminationStatus != 15 {
                    print("[BackendManager] Backend exited (status \(proc.terminationStatus))")
                }
            }
        }

        do {
            try proc.run()
            process = proc
            isRunning = true
            print("[BackendManager] Started backend (\(mode)) on port \(port), PID: \(proc.processIdentifier)")
        } catch {
            print("[BackendManager] Failed to start backend: \(error)")
        }
    }

    func stop() {
        guard let proc = process, proc.isRunning else { return }
        let pid = proc.processIdentifier
        proc.terminate()
        DispatchQueue.global().asyncAfter(deadline: .now() + 3) {
            kill(pid, SIGKILL)
        }
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        isRunning = false
        print("[BackendManager] Stopped backend")
    }

    // MARK: - Helpers

    private func resolveViaWhich(_ binary: String) -> URL? {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        task.arguments = [binary]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = Pipe()
        try? task.run()
        task.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let path = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path)
    }
}
