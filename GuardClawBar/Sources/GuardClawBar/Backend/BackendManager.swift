import Foundation

/// Manages the embedded Node.js backend server lifecycle.
/// Bundles the server inside the .app and spawns it on launch.
@MainActor
final class BackendManager: @unchecked Sendable {
    static let shared = BackendManager()

    private var process: Process?
    private var outputPipe: Pipe?
    private let port: Int = 3002
    private var isRunning = false

    private init() {}

    /// Path to the bundled backend directory inside the app bundle
    private var backendDir: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("backend")
    }

    /// Path to the bundled node binary
    private var nodeBinary: URL? {
        backendDir?.appendingPathComponent("node")
    }

    /// Path to the server entry point
    private var serverEntry: URL? {
        backendDir?.appendingPathComponent("server/index.js")
    }

    /// Whether we have an embedded backend available
    var hasEmbeddedBackend: Bool {
        guard let node = nodeBinary, let entry = serverEntry else { return false }
        return FileManager.default.fileExists(atPath: node.path)
            && FileManager.default.fileExists(atPath: entry.path)
    }

    /// Start the embedded backend server
    func start() {
        guard !isRunning else { return }
        guard hasEmbeddedBackend else {
            print("[BackendManager] No embedded backend found, skipping auto-start")
            return
        }

        guard let node = nodeBinary, let entry = serverEntry, let dir = backendDir else { return }

        let proc = Process()
        proc.executableURL = node
        proc.arguments = [entry.path]
        proc.currentDirectoryURL = dir

        // Set environment
        var env = ProcessInfo.processInfo.environment
        env["PORT"] = String(port)
        env["NODE_ENV"] = "production"
        // Use a writable location for the SQLite database and config
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("GuardClawBar")
        try? FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
        env["GUARDCLAW_DATA_DIR"] = appSupport.path
        proc.environment = env

        // Capture output for debugging
        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = pipe
        outputPipe = pipe

        // Log backend output
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty, let str = String(data: data, encoding: .utf8) {
                print("[Backend] \(str.trimmingCharacters(in: .whitespacesAndNewlines))")
            }
        }

        proc.terminationHandler = { [weak self] proc in
            Task { @MainActor in
                self?.isRunning = false
                if proc.terminationStatus != 0 && proc.terminationStatus != 15 {
                    print("[BackendManager] Backend exited with status \(proc.terminationStatus)")
                }
            }
        }

        do {
            try proc.run()
            process = proc
            isRunning = true
            print("[BackendManager] Started embedded backend on port \(port), PID: \(proc.processIdentifier)")
        } catch {
            print("[BackendManager] Failed to start backend: \(error)")
        }
    }

    /// Stop the embedded backend server
    func stop() {
        guard let proc = process, proc.isRunning else { return }
        let pid = proc.processIdentifier
        proc.terminate()
        // Give it a moment then force kill if needed
        DispatchQueue.global().asyncAfter(deadline: .now() + 3) {
            // Use pid directly to avoid capturing MainActor-isolated self
            kill(pid, SIGKILL)
        }
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        isRunning = false
        print("[BackendManager] Stopped embedded backend")
    }
}
