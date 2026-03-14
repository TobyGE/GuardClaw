import Foundation

actor GuardClawAPI {
    private let session: URLSession

    var baseURL: URL {
        URL(string: SettingsStore.shared.serverURL)!
    }

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        config.timeoutIntervalForResource = 15
        // Allow local networking without ATS issues in dev
        config.waitsForConnectivity = false
        self.session = URLSession(configuration: config)
    }

    // MARK: - Health

    func health() async throws -> HealthResponse {
        try await get("/api/health")
    }

    // MARK: - Status

    func status() async throws -> ServerStatus {
        try await get("/api/status")
    }

    // MARK: - Approvals

    func pendingApprovals() async throws -> PendingApprovalsResponse {
        try await get("/api/approvals/pending")
    }

    func approve(id: String) async throws -> ApprovalActionResponse {
        try await post("/api/approvals/\(id)/approve", body: [:] as [String: String])
    }

    func deny(id: String) async throws -> ApprovalActionResponse {
        try await post("/api/approvals/\(id)/deny", body: [:] as [String: String])
    }

    func resolveOpenClaw(approvalId: String, action: String) async throws -> ApprovalActionResponse {
        try await post("/api/approvals/resolve", body: [
            "approvalId": approvalId,
            "action": action,
        ])
    }

    // MARK: - Setup

    func setupClaudeCode() async throws -> SetupResponse {
        try await post("/api/setup/claude-code", body: [:] as [String: String])
    }

    func claudeCodeStatus() async throws -> CCSetupStatus {
        try await get("/api/setup/claude-code/status")
    }

    func setupOpenClaw() async throws -> SetupResponse {
        try await post("/api/setup/openclaw", body: [:] as [String: String])
    }

    func uninstallClaudeCode() async throws -> SetupResponse {
        try await post("/api/setup/claude-code/uninstall", body: [:] as [String: String])
    }

    func uninstallOpenClaw() async throws -> SetupResponse {
        try await post("/api/setup/openclaw/uninstall", body: [:] as [String: String])
    }

    // Gemini CLI
    func setupGeminiCLI() async throws -> SetupResponse {
        try await post("/api/setup/gemini-cli", body: [:] as [String: String])
    }

    func geminiCLIStatus() async throws -> CCSetupStatus {
        try await get("/api/setup/gemini-cli/status")
    }

    func uninstallGeminiCLI() async throws -> SetupResponse {
        try await post("/api/setup/gemini-cli/uninstall", body: [:] as [String: String])
    }

    // Cursor
    func setupCursor() async throws -> SetupResponse {
        try await post("/api/setup/cursor", body: [:] as [String: String])
    }

    func cursorStatus() async throws -> CCSetupStatus {
        try await get("/api/setup/cursor/status")
    }

    func uninstallCursor() async throws -> SetupResponse {
        try await post("/api/setup/cursor/uninstall", body: [:] as [String: String])
    }

    func openClawPluginStatus() async throws -> CCSetupStatus {
        try await get("/api/setup/openclaw/status")
    }

    // OpenCode
    func setupOpenCode() async throws -> SetupResponse {
        try await post("/api/setup/opencode", body: [:] as [String: String])
    }

    func openCodeStatus() async throws -> CCSetupStatus {
        try await get("/api/setup/opencode/status")
    }

    func uninstallOpenCode() async throws -> SetupResponse {
        try await post("/api/setup/opencode/uninstall", body: [:] as [String: String])
    }

    // MARK: - Models

    func listModels() async throws -> ModelsResponse {
        try await get("/api/models")
    }

    func setupModel(id: String) async throws -> SetupResponse {
        try await post("/api/models/\(id)/setup", body: [:] as [String: String])
    }

    func downloadModel(id: String) async throws -> SetupResponse {
        try await post("/api/models/\(id)/download", body: [:] as [String: String])
    }

    func loadModel(id: String) async throws -> SetupResponse {
        try await post("/api/models/\(id)/load", body: [:] as [String: String])
    }

    func cancelDownload(id: String) async throws -> SetupResponse {
        try await post("/api/models/\(id)/cancel", body: [:] as [String: String])
    }

    func unloadModel() async throws -> SetupResponse {
        try await post("/api/models/unload", body: [:] as [String: String])
    }

    // MARK: - LLM Config

    func switchLLMBackend(backend: String) async throws -> LLMConfigResponse {
        try await post("/api/config/llm", body: ["backend": backend])
    }

    func configLLM(backend: String, lmstudioModel: String? = nil, ollamaModel: String? = nil) async throws -> LLMConfigResponse {
        var body: [String: String] = ["backend": backend]
        if let m = lmstudioModel { body["lmstudioModel"] = m }
        if let m = ollamaModel { body["ollamaModel"] = m }
        return try await post("/api/config/llm", body: body)
    }

    func fetchExternalModels(backend: String) async throws -> ExternalModelsResponse {
        try await post("/api/config/llm/models", body: ["backend": backend])
    }

    func detectToken() async throws -> TokenDetectResponse {
        try await get("/api/config/detect-token")
    }

    func saveToken(token: String) async throws -> GenericResponse {
        try await post("/api/config/token", body: ["token": token])
    }

    // MARK: - Blocking

    func toggleBlocking(enabled: Bool) async throws -> BlockingToggleResponse {
        try await post("/api/blocking/toggle", body: ["enabled": enabled])
    }

    func toggleFailClosed(enabled: Bool) async throws -> FailClosedResponse {
        try await post("/api/config/fail-closed", body: ["enabled": enabled])
    }

    // MARK: - Events

    func eventHistory(limit: Int = 30, backend: String? = nil, since: Int? = nil) async throws -> EventHistoryResponse {
        var query = "/api/events/history?limit=\(limit)"
        if let backend { query += "&backend=\(backend)" }
        if let since { query += "&since=\(since)" }
        return try await get(query)
    }

    // MARK: - Memory

    func memoryStats() async throws -> MemoryStatsResponse {
        try await get("/api/memory/stats")
    }

    func memoryPatterns(limit: Int = 100) async throws -> MemoryPatternsResponse {
        try await get("/api/memory/patterns?limit=\(limit)")
    }

    func memoryReset() async throws -> GenericResponse {
        try await post("/api/memory/reset", body: [:] as [String: String])
    }

    func markDecision(toolName: String, command: String?, decision: String) async throws -> GenericResponse {
        var body: [String: String] = ["toolName": toolName, "decision": decision]
        if let cmd = command { body["command"] = cmd }
        if decision == "approve" { body["alwaysApprove"] = "true" }
        return try await post("/api/memory/record", body: body)
    }

    func ruleSuggestions(useLLM: Bool = false) async throws -> RuleSuggestionsResponse {
        try await get("/api/rules/suggestions\(useLLM ? "?llm=true" : "")")
    }

    // MARK: - Blocking Rules

    func blockingStatus() async throws -> BlockingStatusResponse {
        try await get("/api/blocking/status")
    }

    func addToWhitelist(pattern: String) async throws -> WhitelistResponse {
        try await post("/api/blocking/whitelist", body: ["pattern": pattern])
    }

    func removeFromWhitelist(pattern: String) async throws -> WhitelistResponse {
        try await delete("/api/blocking/whitelist", body: ["pattern": pattern])
    }

    func addToBlacklist(pattern: String) async throws -> BlacklistResponse {
        try await post("/api/blocking/blacklist", body: ["pattern": pattern])
    }

    func removeFromBlacklist(pattern: String) async throws -> BlacklistResponse {
        try await delete("/api/blocking/blacklist", body: ["pattern": pattern])
    }

    // MARK: - Benchmark

    func benchmarkResults() async throws -> BenchmarkResultsResponse {
        try await get("/api/benchmark/results")
    }

    func benchmarkCases() async throws -> BenchmarkCasesResponse {
        try await get("/api/benchmark/cases")
    }

    func abortBenchmark() async throws -> GenericResponse {
        try await post("/api/benchmark/abort", body: [:] as [String: String])
    }

    // MARK: - Security Scan

    func securityScan() async throws -> SecurityScanResponse {
        try await post("/api/setup/security-scan", body: [:] as [String: String])
    }

    // MARK: - Audit

    func auditResults() async throws -> AuditScanResponse {
        return try await get("/api/audit/results")
    }

    func auditProgress() async throws -> AuditScanProgress {
        return try await get("/api/audit/progress")
    }

    func auditScan(scanPath: String? = nil) async throws -> AuditScanResponse {
        var body: [String: String] = [:]
        if let p = scanPath { body["scanPath"] = p }
        // Scan involves AST + LLM review, needs much longer timeout
        let url = baseURL.appendingPathComponent("api/audit/scan")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 300 // 5 minutes
        request.httpBody = try JSONEncoder().encode(body)
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 300
        config.timeoutIntervalForResource = 300
        let longSession = URLSession(configuration: config)
        let (data, response) = try await longSession.data(for: request)
        try validateResponse(response)
        return try JSONDecoder().decode(AuditScanResponse.self, from: data)
    }

    // MARK: - Private

    private func delete<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        let url: URL
        if path.contains("?") {
            url = URL(string: "\(baseURL.absoluteString)\(path)")!
        } else {
            url = baseURL.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try JSONDecoder().decode(T.self, from: data)
    }


    private func get<T: Decodable>(_ path: String) async throws -> T {
        let url = baseURL.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path)
        // Build URL properly for paths with query strings
        let finalURL: URL
        if path.contains("?") {
            finalURL = URL(string: "\(baseURL.absoluteString)\(path)")!
        } else {
            finalURL = url
        }
        let (data, response) = try await session.data(from: finalURL)
        try validateResponse(response)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        let url: URL
        if path.contains("?") {
            url = URL(string: "\(baseURL.absoluteString)\(path)")!
        } else {
            url = baseURL.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func validateResponse(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            throw APIError.httpError(http.statusCode)
        }
    }
}

enum APIError: Error, LocalizedError {
    case invalidResponse
    case httpError(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Invalid response from server"
        case .httpError(let code): return "HTTP error \(code)"
        }
    }
}
