import Dependencies
import DependenciesMacros
import Foundation
import os

@DependencyClient
struct ProcessClient: Sendable {
    var spawn: @Sendable (_ id: UUID, _ path: String, _ arguments: [String], _ workingDirectory: String) async throws -> ProcessHandle
    var terminate: @Sendable (_ id: UUID) async -> Void
    var terminateAll: @Sendable () async -> Void
}

struct ProcessHandle: Sendable {
    let pid: Int32
    let exitStream: AsyncStream<Int32>
    let outputStream: AsyncStream<String>
}

extension ProcessClient: DependencyKey {
    static let liveValue: ProcessClient = {
        ProcessClient(
            spawn: { id, path, arguments, workingDirectory in
                let process = Process()
                process.executableURL = URL(fileURLWithPath: path)
                process.arguments = arguments
                process.currentDirectoryURL = URL(fileURLWithPath: workingDirectory)

                let stdoutPipe = Pipe()
                let stderrPipe = Pipe()
                process.standardOutput = stdoutPipe
                process.standardError = stderrPipe

                let (exitStream, exitContinuation) = AsyncStream<Int32>.makeStream()
                let (outputStream, outputContinuation) = AsyncStream<String>.makeStream()

                let managed = ManagedProcess(
                    process: process,
                    stdoutPipe: stdoutPipe,
                    stderrPipe: stderrPipe,
                    outputContinuation: outputContinuation,
                    exitContinuation: exitContinuation
                )

                stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
                    let data = handle.availableData
                    guard !data.isEmpty else { return }
                    if let line = String(data: data, encoding: .utf8) {
                        PlotLog.runtime.debug("[stdout] \(line.trimmingCharacters(in: .newlines), privacy: .public)")
                        outputContinuation.yield(line)
                    }
                }

                stderrPipe.fileHandleForReading.readabilityHandler = { handle in
                    let data = handle.availableData
                    guard !data.isEmpty else { return }
                    if let line = String(data: data, encoding: .utf8) {
                        PlotLog.runtime.error("[stderr] \(line.trimmingCharacters(in: .newlines), privacy: .public)")
                        outputContinuation.yield(line)
                    }
                }

                process.terminationHandler = { proc in
                    PlotLog.runtime.info("process pid=\(proc.processIdentifier, privacy: .public) terminated with status \(proc.terminationStatus, privacy: .public)")
                    managed.notifyTermination(status: proc.terminationStatus)
                    Task {
                        await ProcessSupervisor.shared.remove(id)
                    }
                }
                
                PlotLog.runtime.info("spawning: \(path, privacy: .public) \(arguments.joined(separator: " "), privacy: .public)")
                PlotLog.runtime.info("  cwd: \(workingDirectory, privacy: .public)")
                do {
                    try process.run()
                } catch {
                    PlotLog.runtime.error("Process.run failed: \(error.localizedDescription, privacy: .public)")
                    managed.notifyTermination(status: -1)
                    throw error
                }
                PlotLog.runtime.info("process started, pid=\(process.processIdentifier, privacy: .public)")

                await ProcessSupervisor.shared.register(id, process: managed)

                return ProcessHandle(
                    pid: process.processIdentifier,
                    exitStream: exitStream,
                    outputStream: outputStream
                )
            },
            terminate: { id in
                await ProcessSupervisor.shared.terminate(id)
            },
            terminateAll: {
                await ProcessSupervisor.shared.terminateAll()
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
