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

    // MARK: - Events

    func eventHistory(limit: Int = 30) async throws -> EventHistoryResponse {
        try await get("/api/events/history?limit=\(limit)")
    }

    // MARK: - Private

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
