import Foundation

struct BenchmarkResultsResponse: Codable, Sendable {
    let results: [BenchmarkRun]
}

struct BenchmarkRun: Codable, Identifiable, Sendable {
    let id: String?
    let model: String?
    let backend: String?
    let timestamp: Double?
    let accuracy: Double?
    let total: Int?
    let correct: Int?
    let falsePositives: Int?
    let falseNegatives: Int?
    let avgLatencyMs: Double?
    let cases: [BenchmarkCase]?

    var displayId: String { id ?? UUID().uuidString }
}

struct BenchmarkCase: Codable, Identifiable, Sendable {
    let id: String?
    let label: String?
    let expected: String?
    let got: String?
    let score: Double?
    let correct: Bool?
    let latencyMs: Double?

    var displayId: String { id ?? UUID().uuidString }
}

struct BenchmarkCasesResponse: Codable, Sendable {
    let cases: Int?
    let traces: [BenchmarkTraceInfo]?
}

struct BenchmarkTraceInfo: Codable, Identifiable, Sendable {
    let id: String?
    let label: String?
    let expected: String?
    let traceLength: Int?

    var displayId: String { id ?? UUID().uuidString }
}

// MARK: - Blocking Models

struct BlockingStatusResponse: Codable, Sendable {
    let enabled: Bool?
    let active: Bool?
    let mode: String?
    let whitelist: [String]?
    let blacklist: [String]?
    let thresholds: BlockingThresholds?
}

struct BlockingThresholds: Codable, Sendable {
    let autoAllow: Double?
    let ask: Double?
    let autoBlock: Double?
}

struct WhitelistResponse: Codable, Sendable {
    let success: Bool?
    let whitelist: [String]?
}

struct BlacklistResponse: Codable, Sendable {
    let success: Bool?
    let blacklist: [String]?
}

// MARK: - Security Scan

struct SecurityScanResponse: Codable, Sendable {
    let ok: Bool?
    let findings: [SecurityFinding]?
    let summary: SecurityScanSummary?
}

struct SecurityScanSummary: Codable, Sendable {
    let categories: Int?
    let total: Int?
    let recommendations: Int?
}

struct SecurityFinding: Codable, Identifiable, Sendable {
    let id: String?
    let category: String?
    let severity: String?
    let title: String?
    let detail: String?
    let recommendation: String?

    var displayId: String { id ?? UUID().uuidString }
}
