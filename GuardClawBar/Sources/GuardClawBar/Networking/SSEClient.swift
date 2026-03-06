import Foundation

struct SSEEvent {
    var eventType: String = "message"
    var data: String = ""
    var id: String? = nil
}

/// Simple Server-Sent Events client using URLSession streaming.
/// Usage: `for await event in await client.events() { ... }`
final class SSEClient: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let url: URL
    private var continuation: AsyncStream<SSEEvent>.Continuation?
    private var session: URLSession?
    private var buffer = ""
    private var currentEvent = SSEEvent()

    init(url: URL) {
        self.url = url
        super.init()
    }

    func events() async -> AsyncStream<SSEEvent> {
        AsyncStream { continuation in
            self.continuation = continuation
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 60 * 60  // 1 hour — SSE is long-lived
            config.timeoutIntervalForResource = 60 * 60
            let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
            self.session = session
            var request = URLRequest(url: self.url)
            request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
            request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
            let task = session.dataTask(with: request)
            task.resume()
            continuation.onTermination = { _ in
                task.cancel()
                session.invalidateAndCancel()
            }
        }
    }

    // MARK: - URLSessionDataDelegate

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        buffer += text
        processBuffer()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        continuation?.finish()
    }

    // MARK: - SSE Parsing

    private func processBuffer() {
        // SSE spec: events separated by double newlines
        while let range = buffer.range(of: "\n\n") {
            let chunk = String(buffer[buffer.startIndex..<range.lowerBound])
            buffer = String(buffer[range.upperBound...])
            parseChunk(chunk)
        }
    }

    private func parseChunk(_ chunk: String) {
        // Skip keepalive comments (lines starting with ":")
        if chunk.hasPrefix(":") { return }

        var event = SSEEvent()
        var dataLines: [String] = []

        for line in chunk.components(separatedBy: "\n") {
            if line.hasPrefix("event:") {
                event.eventType = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                dataLines.append(String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces))
            } else if line.hasPrefix("id:") {
                event.id = line.dropFirst(3).trimmingCharacters(in: .whitespaces)
            }
            // Ignore "retry:" lines
        }

        if !dataLines.isEmpty {
            event.data = dataLines.joined(separator: "\n")
            continuation?.yield(event)
        }
    }
}
