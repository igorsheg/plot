import Dependencies
import DependenciesMacros
import Foundation
import os

@DependencyClient
struct ProcessClient: Sendable {
    var spawn: @Sendable (_ path: String, _ arguments: [String], _ workingDirectory: String) async throws -> ProcessHandle
    var terminate: @Sendable (_ handle: ProcessHandle) async -> Void
}

struct ProcessHandle: Sendable {
    let pid: Int32
    let exitStream: AsyncStream<Int32>
}

extension ProcessClient: DependencyKey {
    static let liveValue: ProcessClient = {
        ProcessClient(
            spawn: { path, arguments, workingDirectory in
                let process = Process()
                process.executableURL = URL(fileURLWithPath: path)
                process.arguments = arguments
                process.currentDirectoryURL = URL(fileURLWithPath: workingDirectory)
                process.standardOutput = FileHandle.nullDevice
                process.standardError = FileHandle.nullDevice

                let (stream, continuation) = AsyncStream<Int32>.makeStream()
                process.terminationHandler = { proc in
                    continuation.yield(proc.terminationStatus)
                    continuation.finish()
                }

                PlotLog.runtime.info("Process.run: \(path) pid will be assigned")
                do {
                    try process.run()
                } catch {
                    PlotLog.runtime.error("Process.run failed: \(error.localizedDescription)")
                    throw error
                }
                PlotLog.runtime.info("Process started with pid \(process.processIdentifier)")

                return ProcessHandle(pid: process.processIdentifier, exitStream: stream)
            },
            terminate: { handle in
                kill(handle.pid, SIGTERM)

                try? await Task.sleep(for: .seconds(5))
                kill(handle.pid, SIGKILL)
            }
        )
    }()
}

extension DependencyValues {
    var processClient: ProcessClient {
        get { self[ProcessClient.self] }
        set { self[ProcessClient.self] = newValue }
    }
}
