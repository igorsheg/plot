import Foundation
import os

actor ProcessSupervisor {
    static let shared = ProcessSupervisor()

    private var entries: [UUID: ManagedProcess] = [:]

    func register(_ id: UUID, process: ManagedProcess) {
        entries[id] = process
    }

    func remove(_ id: UUID) {
        entries.removeValue(forKey: id)
    }

    func terminate(_ id: UUID) async {
        guard let entry = entries[id] else { return }
        PlotLog.runtime.info("terminating process for project \(id.uuidString)")
        await entry.terminate()
    }

    func terminateAll() async {
        let ids = Array(entries.keys)
        PlotLog.runtime.info("terminating all \(ids.count) processes")
        await withTaskGroup(of: Void.self) { group in
            for id in ids {
                group.addTask { await self.terminate(id) }
            }
        }
    }
}

final class ManagedProcess: @unchecked Sendable {
    let process: Process
    private let stdoutPipe: Pipe
    private let stderrPipe: Pipe
    private let outputContinuation: AsyncStream<String>.Continuation
    private let exitContinuation: AsyncStream<Int32>.Continuation

    private let lock = NSLock()
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

    func finish(status: Int32) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            return
        }
        finished = true
        let waiters = exitWaiters
        exitWaiters.removeAll()
        lock.unlock()

        stdoutPipe.fileHandleForReading.readabilityHandler = nil
        stderrPipe.fileHandleForReading.readabilityHandler = nil
        try? stdoutPipe.fileHandleForReading.close()
        try? stderrPipe.fileHandleForReading.close()

        outputContinuation.finish()
        exitContinuation.yield(status)
        exitContinuation.finish()

        waiters.forEach { $0.resume() }
    }

    private func addWaiterOrReturnFinished(_ continuation: CheckedContinuation<Void, Never>) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if finished {
            return true
        }
        exitWaiters.append(continuation)
        return false
    }

    func waitForExit() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            if addWaiterOrReturnFinished(continuation) {
                continuation.resume()
            }
        }
    }

    func terminate() async {
        guard process.isRunning else { return }

        PlotLog.runtime.info("sending SIGTERM to pid \(self.process.processIdentifier)")
        process.terminate()

        await withTaskGroup(of: Bool.self) { group in
            group.addTask {
                await self.waitForExit()
                return true
            }
            group.addTask {
                try? await Task.sleep(for: .seconds(5))
                return false
            }

            let exited = await group.next() ?? false
            group.cancelAll()

            if !exited && process.isRunning {
                PlotLog.runtime.warning("SIGTERM timeout, sending SIGKILL to pid \(self.process.processIdentifier)")
                kill(process.processIdentifier, SIGKILL)
                await waitForExit()
            }
        }
    }
}
