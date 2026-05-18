import Foundation

struct SSEEvent: Sendable {
    var eventType: String = "message"
    var data: String = ""
    var id: String? = nil
}

/// Server-Sent Events client over URLSession.
///
/// Concurrency: the URLSession delegate may be invoked from arbitrary delegate-queue
/// threads. Mutable parser state lives inside a dedicated `Parser` actor. Delegate
/// callbacks (`didReceive` / `didCompleteWithError`) are *not* hopped to the parser
/// via independent `Task`s — that loses ordering, and `finish()` can race ahead of
/// pending `ingest()` calls, dropping the last chunk of the stream. Instead, the
/// delegate synchronously `yield`s onto a serial `AsyncStream<DelegateMessage>`
/// inbox, and a single drain task forwards messages to the parser in order.
///
/// Usage: `for await event in await client.events() { ... }`
final class SSEClient: NSObject, URLSessionDataDelegate, Sendable {
    private enum DelegateMessage: Sendable {
        case data(String)
        case complete
    }

    private let url: URL
    private let parser = Parser()
    private let inbox: AsyncStream<DelegateMessage>
    private let inboxYield: AsyncStream<DelegateMessage>.Continuation

    init(url: URL) {
        self.url = url
        var cont: AsyncStream<DelegateMessage>.Continuation!
        self.inbox = AsyncStream(bufferingPolicy: .unbounded) { cont = $0 }
        self.inboxYield = cont
        super.init()
        // Single consumer: drains the inbox in order so ingest/finish stay serialized.
        let parser = self.parser
        let inbox = self.inbox
        Task.detached {
            for await msg in inbox {
                switch msg {
                case .data(let text): await parser.ingest(text)
                case .complete:       await parser.finish()
                }
            }
        }
    }

    func events() async -> AsyncStream<SSEEvent> {
        AsyncStream { continuation in
            let url = self.url
            let parser = self.parser
            let inboxYield = self.inboxYield
            Task {
                let session = await parser.start(continuation: continuation, delegate: self)
                var request = URLRequest(url: url)
                request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                let task = session.dataTask(with: request)
                task.resume()
                continuation.onTermination = { _ in
                    task.cancel()
                    // Stop the drain loop, then invalidate the URLSession.
                    inboxYield.finish()
                    Task { await parser.invalidate() }
                }
            }
        }
    }

    // MARK: - URLSessionDataDelegate (synchronous yield → preserves order)

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        inboxYield.yield(.data(text))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        inboxYield.yield(.complete)
    }
}

private actor Parser {
    private var continuation: AsyncStream<SSEEvent>.Continuation?
    private var session: URLSession?
    private var buffer = ""

    func start(continuation: AsyncStream<SSEEvent>.Continuation, delegate: URLSessionDataDelegate) -> URLSession {
        self.continuation = continuation
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60 * 60  // SSE is long-lived
        config.timeoutIntervalForResource = 60 * 60
        let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
        self.session = session
        return session
    }

    func ingest(_ text: String) {
        buffer += text
        while let range = buffer.range(of: "\n\n") {
            let chunk = String(buffer[buffer.startIndex..<range.lowerBound])
            buffer = String(buffer[range.upperBound...])
            parseChunk(chunk)
        }
    }

    func finish() {
        continuation?.finish()
        continuation = nil
    }

    func invalidate() {
        session?.invalidateAndCancel()
        session = nil
    }

    private func parseChunk(_ chunk: String) {
        if chunk.hasPrefix(":") { return } // keepalive comment

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
        }
        if !dataLines.isEmpty {
            event.data = dataLines.joined(separator: "\n")
            continuation?.yield(event)
        }
    }
}
