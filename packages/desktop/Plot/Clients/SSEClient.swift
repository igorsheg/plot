import Dependencies
import DependenciesMacros
import Foundation

@DependencyClient
struct SSEClient: Sendable {
    var connect: @Sendable (_ url: URL) -> AsyncThrowingStream<SSEEvent, Error> = { _ in
        AsyncThrowingStream { $0.finish() }
    }
}

enum SSEEvent: Sendable, Equatable {
    case data(String)
    case heartbeat
}

extension SSEClient: DependencyKey {
    static let liveValue = SSEClient(
        connect: { url in
            AsyncThrowingStream { continuation in
                let task = Task {
                    do {
                        var request = URLRequest(url: url)
                        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                        request.timeoutInterval = 60

                        let (bytes, response) = try await URLSession.shared.bytes(for: request)

                        guard let httpResponse = response as? HTTPURLResponse,
                              httpResponse.statusCode == 200 else {
                            continuation.finish(throwing: SSEError.badStatus)
                            return
                        }

                        var buffer = ""
                        for try await line in bytes.lines {
                            if Task.isCancelled { break }

                            if line.hasPrefix(": ") || line == ":" {
                                continuation.yield(.heartbeat)
                                continue
                            }

                            if line.hasPrefix("data: ") {
                                buffer = String(line.dropFirst(6))
                            } else if line.isEmpty && !buffer.isEmpty {
                                continuation.yield(.data(buffer))
                                buffer = ""
                            }
                        }
                        continuation.finish()
                    } catch {
                        if !Task.isCancelled {
                            continuation.finish(throwing: error)
                        }
                    }
                }
                continuation.onTermination = { _ in task.cancel() }
            }
        }
    )
}

enum SSEError: Error, Sendable {
    case badStatus
    case disconnected
}

extension DependencyValues {
    var sseClient: SSEClient {
        get { self[SSEClient.self] }
        set { self[SSEClient.self] = newValue }
    }
}
