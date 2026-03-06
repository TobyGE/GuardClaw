import SwiftUI

struct BenchmarkView: View {
    @State private var results: [BenchmarkRun] = []
    @State private var isRunning = false
    @State private var progress: Double = 0
    @State private var progressMessage = ""
    @State private var statusMessage: String? = nil
    @State private var selectedRun: BenchmarkRun? = nil

    private let api = GuardClawAPI()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Run controls
                runControlSection

                // Progress
                if isRunning {
                    progressSection
                }

                // Historical results
                if !results.isEmpty {
                    resultsSection
                } else if !isRunning {
                    ContentUnavailableView(
                        "No Results Yet",
                        systemImage: "chart.bar",
                        description: Text("Run the benchmark to test your judge's accuracy")
                    )
                    .frame(height: 200)
                }

                if let msg = statusMessage {
                    Text(msg)
                        .font(.caption)
                        .foregroundStyle(msg.contains("✓") ? .green : .red)
                }
            }
            .padding(24)
        }
        .navigationTitle("Benchmark")
        .onAppear { loadResults() }
    }

    // MARK: - Run Controls

    private var runControlSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Accuracy Benchmark")
                .font(.headline)

            Text("Tests the safety judge against 30 curated scenarios. Higher is better — aim for 85%+.")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 10) {
                if isRunning {
                    Button(role: .destructive) {
                        Task { await abortBenchmark() }
                    } label: {
                        Label("Abort", systemImage: "stop.fill")
                    }
                    .buttonStyle(.bordered)
                    .tint(.red)
                } else {
                    Button {
                        Task { await runBenchmark() }
                    } label: {
                        Label("Run Benchmark", systemImage: "play.fill")
                    }
                    .buttonStyle(.borderedProminent)
                }

                Spacer()

                if let latest = results.first, let acc = latest.accuracy {
                    HStack(spacing: 4) {
                        Text("Latest:")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("\(Int(acc * 100))%")
                            .font(.caption)
                            .fontWeight(.bold)
                            .foregroundStyle(acc >= 0.85 ? .green : acc >= 0.7 ? .orange : .red)
                    }
                }
            }
        }
        .padding(16)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Progress

    private var progressSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            ProgressView(value: progress)
                .tint(.blue)
            Text(progressMessage.isEmpty ? "Running..." : progressMessage)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .background(.blue.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(.blue.opacity(0.2), lineWidth: 1))
    }

    // MARK: - Results

    private var resultsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Results History")
                .font(.headline)

            ForEach(results) { run in
                BenchmarkRunCard(run: run, isSelected: selectedRun?.displayId == run.displayId) {
                    selectedRun = selectedRun?.displayId == run.displayId ? nil : run
                }

                if selectedRun?.displayId == run.displayId, let cases = run.cases {
                    BenchmarkCasesTable(cases: cases)
                }
            }
        }
    }

    // MARK: - Actions

    private func loadResults() {
        Task {
            if let resp = try? await api.benchmarkResults() {
                results = resp.results.sorted { ($0.timestamp ?? 0) > ($1.timestamp ?? 0) }
            }
        }
    }

    private func runBenchmark() async {
        isRunning = true
        progress = 0
        progressMessage = "Starting benchmark..."

        guard let url = URL(string: "\(SettingsStore.shared.serverURL)/api/benchmark/run") else {
            isRunning = false; return
        }

        do {
            let session = URLSession.shared
            let (asyncBytes, _) = try await session.bytes(from: url)
            var buffer = ""

            for try await byte in asyncBytes {
                buffer += String(UnicodeScalar(byte))
                if buffer.contains("\n\n") {
                    let chunks = buffer.components(separatedBy: "\n\n")
                    for chunk in chunks.dropLast() {
                        processSSEChunk(chunk)
                    }
                    buffer = chunks.last ?? ""
                }
            }
        } catch {
            statusMessage = "Benchmark error: \(error.localizedDescription)"
        }

        isRunning = false
        loadResults()
    }

    private func processSSEChunk(_ chunk: String) {
        for line in chunk.components(separatedBy: "\n") {
            guard line.hasPrefix("data:") else { continue }
            let jsonStr = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
            guard let data = jsonStr.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }

            let type = json["type"] as? String ?? ""
            switch type {
            case "progress":
                let done = json["completed"] as? Int ?? 0
                let total = json["total"] as? Int ?? 1
                let label = json["label"] as? String ?? ""
                progress = Double(done) / Double(total)
                progressMessage = "[\(done)/\(total)] \(label)"
            case "complete":
                let acc = (json["accuracy"] as? Double ?? 0) * 100
                statusMessage = "✓ Done — accuracy: \(String(format: "%.0f", acc))%"
            case "aborted":
                statusMessage = "Benchmark aborted"
            case "error":
                statusMessage = "Error: \(json["error"] as? String ?? "unknown")"
            default: break
            }
        }
    }

    private func abortBenchmark() async {
        _ = try? await api.abortBenchmark()
        isRunning = false
        statusMessage = "Aborted"
    }
}

struct BenchmarkRunCard: View {
    let run: BenchmarkRun
    let isSelected: Bool
    let onTap: () -> Void

    private var accuracy: Double { run.accuracy ?? 0 }
    private var accuracyColor: Color { accuracy >= 0.85 ? .green : accuracy >= 0.7 ? .orange : .red }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                // Accuracy ring
                ZStack {
                    Circle()
                        .stroke(.quaternary, lineWidth: 4)
                    Circle()
                        .trim(from: 0, to: accuracy)
                        .stroke(accuracyColor, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    Text("\(Int(accuracy * 100))%")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(accuracyColor)
                }
                .frame(width: 48, height: 48)

                VStack(alignment: .leading, spacing: 3) {
                    Text(run.model ?? "Default")
                        .font(.subheadline)
                        .fontWeight(.medium)
                    Text("\(run.correct ?? 0)/\(run.total ?? 0) correct · \(run.backend ?? "unknown")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let latency = run.avgLatencyMs {
                        Text("Avg \(String(format: "%.0f", latency))ms")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                Spacer()
                Image(systemName: isSelected ? "chevron.up" : "chevron.down")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .buttonStyle(.plain)
        .padding(12)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(isSelected ? accuracyColor.opacity(0.5) : .clear, lineWidth: 1.5)
        )
    }
}

struct BenchmarkCasesTable: View {
    let cases: [BenchmarkCase]

    var body: some View {
        VStack(spacing: 2) {
            ForEach(cases, id: \.displayId) { c in
                HStack(spacing: 8) {
                    Image(systemName: c.correct == true ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(c.correct == true ? .green : .red)
                        .font(.caption)

                    Text(c.label ?? c.displayId)
                        .font(.caption)
                        .lineLimit(1)

                    Spacer()

                    if let expected = c.expected, let got = c.got, expected != got {
                        Text("exp:\(expected) got:\(got)")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }

                    if let latency = c.latencyMs {
                        Text("\(String(format: "%.0f", latency))ms")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(.quaternary.opacity(0.2), in: RoundedRectangle(cornerRadius: 6))
            }
        }
    }
}
