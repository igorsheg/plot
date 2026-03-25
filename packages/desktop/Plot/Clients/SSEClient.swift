import Dependencies
import DependenciesMacros
import Foundation
import os

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
                        request.timeoutInterval = 120
                        
                        let (bytes, response) = try await URLSession.shared.bytes(for: request)
                        
                        guard let httpResponse = response as? HTTPURLResponse,
                              httpResponse.statusCode == 200 else {
                            PlotLog.runtime.error("SSE bad status: \((response as? HTTPURLResponse)?.statusCode ?? -1, privacy: .public)")
                            continuation.finish(throwing: SSEError.badStatus)
                            return
                        }
                        
                        PlotLog.runtime.info("SSE connected to \(url.absoluteString, privacy: .public)")
                        
                        // Parse SSE manually from raw bytes — bytes.lines can buffer
                        var lineBuffer = Data()
                        var currentData = ""
                        
                        for try await byte in bytes {
                            if Task.isCancelled { break }
                            
                            if byte == UInt8(ascii: "\n") {
                                let line = String(data: lineBuffer, encoding: .utf8) ?? ""
                                lineBuffer.removeAll(keepingCapacity: true)
                                
                                if line.isEmpty {
                                    // Empty line = end of SSE frame
                                    if !currentData.isEmpty {
                                        PlotLog.runtime.debug("SSE data frame (\(currentData.count, privacy: .public) bytes)")
                                        continuation.yield(.data(currentData))
                                        currentData = ""
                                    }
                                } else if line.hasPrefix("data: ") {
                                    currentData = String(line.dropFirst(6))
                                } else if line.hasPrefix(":") {
                                    continuation.yield(.heartbeat)
                                }
                            } else {
                                lineBuffer.append(byte)
                            }
                        }
                        continuation.finish()
                    } catch {
                        if !Task.isCancelled {
                            PlotLog.runtime.error("SSE error: \(error.localizedDescription, privacy: .public)")
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
