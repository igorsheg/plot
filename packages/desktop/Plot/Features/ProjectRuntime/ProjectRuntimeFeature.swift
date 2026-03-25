import ComposableArchitecture
import Foundation
import os

@Reducer
struct ProjectRuntimeFeature {
    @ObservableState
    struct State: Equatable, Identifiable {
        var id: Project.ID { projectId }
        var projectId: Project.ID
        var lifecycle: ProjectLifecycle = .idle
        var snapshot: RuntimeSnapshot = .empty
        var port: UInt16?
    }

    enum Action: Equatable {
        case start(String)
        case stop
        case processExited(Int32)
        case healthCheckPassed
        case healthCheckFailed
        case sseEvent(SSEEvent)
        case sseFailed
        case spawnFailed(String)
    }

    enum CancelID: Hashable {
        case process(Project.ID)
        case health(Project.ID)
        case events(Project.ID)
    }

    @Dependency(\.processClient) var processClient
    @Dependency(\.sseClient) var sseClient
    @Dependency(\.portAllocator) var portAllocator
    @Dependency(\.binaryResolver) var binaryResolver
    @Dependency(\.continuousClock) var clock

    var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .start(let projectPath):
                guard !state.lifecycle.isActive else { return .none }

                guard let port = portAllocator.allocate() else {
                    PlotLog.runtime.error("no available ports for \(projectPath, privacy: .public)")
                    state.lifecycle = .failed("No available ports")
                    return .none
                }
                state.port = port
                state.lifecycle = .launching

                let projectId = state.projectId
                let workflowPath = (projectPath as NSString).appendingPathComponent("WORKFLOW.md")

                return .merge(
                    .run { [binaryResolver] send in
                        do {
                            let resolution = binaryResolver.resolve(projectPath)
                            let args = resolution.arguments + ["serve", "--port", "\(port)", "--workflow", workflowPath]
                            PlotLog.runtime.info("spawning: \(resolution.path, privacy: .public) \(args.joined(separator: " "), privacy: .public)")

                            let handle = try await processClient.spawn(projectId, resolution.path, args, projectPath)

                            for await exitCode in handle.exitStream {
                                await send(.processExited(exitCode))
                            }
                        } catch {
                            PlotLog.runtime.error("spawn failed: \(error.localizedDescription, privacy: .public)")
                            await send(.spawnFailed(error.localizedDescription))
                        }
                    }
                    .cancellable(id: CancelID.process(projectId), cancelInFlight: true),

                    .run { send in
                        try await clock.sleep(for: .seconds(1))
                        for _ in 0..<30 {
                            if Task.isCancelled { return }
                            let url = URL(string: "http://localhost:\(port)/healthz")!
                            if let (_, response) = try? await URLSession.shared.data(from: url),
                               let http = response as? HTTPURLResponse,
                               http.statusCode == 200 {
                                await send(.healthCheckPassed)
                                return
                            }
                            try await clock.sleep(for: .seconds(1))
                        }
                        await send(.healthCheckFailed)
                    }
                    .cancellable(id: CancelID.health(projectId), cancelInFlight: true)
                )

            case .healthCheckPassed:
                let port = state.port.map(String.init) ?? "unknown"
                PlotLog.runtime.info("health check passed on port \(port, privacy: .public)")
                state.lifecycle = .connecting
                let projectId = state.projectId
                guard let portNum = state.port else { return .none }

                return .run { send in
                    let url = URL(string: "http://localhost:\(portNum)/rpc/events")!
                    let stream = sseClient.connect(url)

                    do {
                        for try await event in stream {
                            if Task.isCancelled { return }
                            await send(.sseEvent(event))
                        }
                    } catch {
                        if !Task.isCancelled {
                            await send(.sseFailed)
                        }
                    }
                }
                .cancellable(id: CancelID.events(projectId), cancelInFlight: true)

            case .healthCheckFailed:
                let port = state.port.map(String.init) ?? "unknown"
                PlotLog.runtime.error("health check failed after 30 attempts on port \(port, privacy: .public)")
                state.lifecycle = .failed("Server did not become ready")
                let projectId = state.projectId
                return .merge(
                    .cancel(id: CancelID.health(projectId)),
                    .cancel(id: CancelID.events(projectId)),
                    .run { _ in await processClient.terminate(projectId) }
                )

            case .sseEvent(.data(let json)):
                let decoder = JSONDecoder()
                if let data = json.data(using: .utf8),
                   let snapshot = try? decoder.decode(RuntimeSnapshot.self, from: data) {
                    state.snapshot = snapshot
                    if state.lifecycle != .streaming {
                        PlotLog.runtime.info("first snapshot received, marking as streaming")
                        state.lifecycle = .streaming
                    }
                } else {
                    PlotLog.runtime.error("failed to decode SSE snapshot: \(json.prefix(200), privacy: .public)")
                }
                return .none

            case .sseEvent(.heartbeat):
                return .none

            case .sseFailed:
                PlotLog.runtime.error("SSE connection lost")
                state.lifecycle = .failed("SSE connection lost")
                let projectId = state.projectId
                return .merge(
                    .cancel(id: CancelID.events(projectId)),
                    .run { _ in await processClient.terminate(projectId) }
                )

            case .processExited(let code):
                PlotLog.runtime.info("process exited with code \(code, privacy: .public)")
                let projectId = state.projectId
                if let port = state.port {
                    portAllocator.release(port)
                    state.port = nil
                }
                state.snapshot = .empty

                if code == 0 || state.lifecycle == .stopping {
                    state.lifecycle = .stopped
                } else {
                    state.lifecycle = .failed("Process exited with code \(code)")
                }
                return .merge(
                    .cancel(id: CancelID.health(projectId)),
                    .cancel(id: CancelID.events(projectId))
                )

            case .stop:
                let projectId = state.projectId
                PlotLog.runtime.info("stopping project \(projectId, privacy: .public)")
                state.lifecycle = .stopping
                state.snapshot = .empty

                return .merge(
                    .cancel(id: CancelID.health(projectId)),
                    .cancel(id: CancelID.events(projectId)),
                    .run { _ in await processClient.terminate(projectId) }
                )

            case .spawnFailed(let message):
                let projectId = state.projectId
                if let port = state.port {
                    portAllocator.release(port)
                    state.port = nil
                }
                state.lifecycle = .failed(message)
                return .merge(
                    .cancel(id: CancelID.health(projectId)),
                    .cancel(id: CancelID.events(projectId))
                )
            }
        }
    }
}
