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
    let outputStream: AsyncStream<String>
}

extension ProcessClient: DependencyKey {
    static let liveValue: ProcessClient = {
        ProcessClient(
            spawn: { path, arguments, workingDirectory in
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
                
                // Read stdout
                stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
                    let data = handle.availableData
                    guard !data.isEmpty else { return }
                    if let line = String(data: data, encoding: .utf8) {
                        PlotLog.runtime.debug("[stdout] \(line.trimmingCharacters(in: .newlines))")
                        outputContinuation.yield(line)
                    }
                }
                
                // Read stderr
                stderrPipe.fileHandleForReading.readabilityHandler = { handle in
                    let data = handle.availableData
                    guard !data.isEmpty else { return }
                    if let line = String(data: data, encoding: .utf8) {
                        PlotLog.runtime.error("[stderr] \(line.trimmingCharacters(in: .newlines))")
                        outputContinuation.yield(line)
                    }
                }
                
                process.terminationHandler = { proc in
                    stdoutPipe.fileHandleForReading.readabilityHandler = nil
                    stderrPipe.fileHandleForReading.readabilityHandler = nil
                    outputContinuation.finish()
                    exitContinuation.yield(proc.terminationStatus)
                    exitContinuation.finish()
                }
                
                PlotLog.runtime.info("spawning: \(path) \(arguments.joined(separator: " "))")
                PlotLog.runtime.info("  cwd: \(workingDirectory)")
                do {
                    try process.run()
                } catch {
                    PlotLog.runtime.error("Process.run failed: \(error.localizedDescription)")
                    throw error
                }
                PlotLog.runtime.info("process started, pid=\(process.processIdentifier)")
                
                return ProcessHandle(
                    pid: process.processIdentifier,
                    exitStream: exitStream,
                    outputStream: outputStream
                )
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
