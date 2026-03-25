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
    let exitStream: AsyncStream<Int32>
}

extension ProcessClient: DependencyKey {
    private static let registry = ProcessRegistry()

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
                let (_, outputContinuation) = AsyncStream<String>.makeStream()

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
                        await registry.remove(id)
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

                await registry.register(id, process: managed)

                return ProcessHandle(exitStream: exitStream)
            },
            terminate: { id in
                await registry.terminate(id)
            },
            terminateAll: {
                await registry.terminateAll()
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

// MARK: - Private process registry

private actor ProcessRegistry {
    private var entries: [UUID: ManagedProcess] = [:]

    func register(_ id: UUID, process: ManagedProcess) {
        entries[id] = process
    }

    func remove(_ id: UUID) {
        entries.removeValue(forKey: id)
    }

    func terminate(_ id: UUID) async {
        guard let entry = entries[id] else { return }
        PlotLog.runtime.info("terminating process for project \(id.uuidString, privacy: .public)")
        await entry.terminate()
    }

    func terminateAll() async {
        let ids = Array(entries.keys)
        PlotLog.runtime.info("terminating all \(ids.count, privacy: .public) processes")
        await withTaskGroup(of: Void.self) { group in
            for id in ids {
                group.addTask { await self.terminate(id) }
            }
        }
    }
}

// MARK: - Managed process lifecycle

actor ManagedProcess {
    private let process: Process
    private let stdoutPipe: Pipe
    private let stderrPipe: Pipe
    private let outputContinuation: AsyncStream<String>.Continuation
    private let exitContinuation: AsyncStream<Int32>.Continuation

    private var exitWaiters: [CheckedContinuation<Void, Never>] = []
    private var finished = false

    init(
        process: Process,
        stdoutPipe: Pipe,
        stderrPipe: Pipe,
        outputContinuation: AsyncStream<String>.Continuation,
        exitContinuation: AsyncStream<Int32>.Continuation
    ) {
        self.process = process
        self.stdoutPipe = stdoutPipe
        self.stderrPipe = stderrPipe
        self.outputContinuation = outputContinuation
        self.exitContinuation = exitContinuation
    }

    nonisolated func notifyTermination(status: Int32) {
        Task { await self.finish(status: status) }
    }

    private func finish(status: Int32) {
        guard !finished else { return }
        finished = true

        stdoutPipe.fileHandleForReading.readabilityHandler = nil
        stderrPipe.fileHandleForReading.readabilityHandler = nil
        try? stdoutPipe.fileHandleForReading.close()
        try? stderrPipe.fileHandleForReading.close()

        outputContinuation.finish()
        exitContinuation.yield(status)
        exitContinuation.finish()

        let waiters = exitWaiters
        exitWaiters.removeAll()
        waiters.forEach { $0.resume() }
    }

    func waitForExit() async {
        if finished { return }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            exitWaiters.append(continuation)
        }
    }

    func terminate() async {
        guard process.isRunning else { return }

        let pid = process.processIdentifier
        PlotLog.runtime.info("sending SIGTERM to pid \(pid, privacy: .public)")
        process.terminate()

        let exitedCleanly = await withTaskGroup(of: Bool.self) { group -> Bool in
            group.addTask {
                await self.waitForExit()
                return true
            }
            group.addTask {
                try? await Task.sleep(for: .seconds(5))
                return false
            }

            let result = await group.next() ?? false
            group.cancelAll()
            return result
        }

        if !exitedCleanly && process.isRunning {
            PlotLog.runtime.warning("SIGTERM timeout, sending SIGKILL to pid \(pid, privacy: .public)")
            kill(pid, SIGKILL)
            await waitForExit()
        }
    }
}
