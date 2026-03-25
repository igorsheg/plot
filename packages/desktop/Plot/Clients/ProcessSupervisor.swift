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

/// Wraps a Foundation.Process with its pipes and stream continuations.
/// Uses an actor for thread-safe state management.
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
    
    /// Called from Process.terminationHandler (nonisolated context).
    /// We use `nonisolated` + `Task` to safely transition into the actor.
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
        PlotLog.runtime.info("sending SIGTERM to pid \(pid)")
        process.terminate()
        
        // Race: wait for clean exit vs 5s timeout
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
            PlotLog.runtime.warning("SIGTERM timeout, sending SIGKILL to pid \(pid)")
            kill(pid, SIGKILL)
            await waitForExit()
        }
    }
}
