import ComposableArchitecture
import Foundation

@Reducer
struct ProjectRuntimeFeature {
    @ObservableState
    struct State: Equatable {
        var projectId: Project.ID
        var lifecycle: ProjectLifecycle = .idle
        var snapshot: RuntimeSnapshot = .empty
        var port: UInt16?
    }
    
    enum Action: Equatable {
        case start(String) // project path
        case stop
        case lifecycleChanged(ProjectLifecycle)
        case snapshotReceived(RuntimeSnapshot)
        case processExited(Int32)
        case healthCheckPassed
        case healthCheckFailed
        case sseEvent(SSEEvent)
        case sseFailed
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
                    state.lifecycle = .failed("No available ports")
                    return .send(.lifecycleChanged(.failed("No available ports")))
                }
                state.port = port
                state.lifecycle = .launching
                
                let projectId = state.projectId
                let workflowPath = (projectPath as NSString).appendingPathComponent("WORKFLOW.md")
                
                return .merge(
                    .send(.lifecycleChanged(.launching)),
                    .run { [binaryResolver] send in
                        let resolution = binaryResolver.resolve(projectPath)
                        let args = resolution.arguments + ["serve", "--port", "\(port)", "--workflow", workflowPath]
                        
                        let handle = try await processClient.spawn(resolution.path, args, projectPath)
                        
                        for await exitCode in handle.exitStream {
                            await send(.processExited(exitCode))
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
                state.lifecycle = .connecting
                let projectId = state.projectId
                guard let port = state.port else { return .none }
                
                return .merge(
                    .send(.lifecycleChanged(.connecting)),
                    .run { send in
                        let url = URL(string: "http://localhost:\(port)/rpc/events")!
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
                )
                
            case .healthCheckFailed:
                state.lifecycle = .failed("Server did not become ready")
                return .send(.lifecycleChanged(.failed("Server did not become ready")))
                
            case .sseEvent(.data(let json)):
                let decoder = JSONDecoder()
                if let data = json.data(using: .utf8),
                   let snapshot = try? decoder.decode(RuntimeSnapshot.self, from: data) {
                    state.snapshot = snapshot
                    if state.lifecycle != .streaming {
                        state.lifecycle = .streaming
                        return .merge(
                            .send(.lifecycleChanged(.streaming)),
                            .send(.snapshotReceived(snapshot))
                        )
                    }
                    return .send(.snapshotReceived(snapshot))
                }
                return .none
                
            case .sseEvent(.heartbeat):
                return .none
                
            case .sseFailed:
                state.lifecycle = .failed("SSE connection lost")
                return .send(.lifecycleChanged(.failed("SSE connection lost")))
                
            case .processExited(let code):
                let projectId = state.projectId
                if let port = state.port {
                    portAllocator.release(port)
                    state.port = nil
                }
                state.snapshot = .empty
                
                if code == 0 {
                    state.lifecycle = .stopped
                    return .merge(
                        .send(.lifecycleChanged(.stopped)),
                        .cancel(id: CancelID.health(projectId)),
                        .cancel(id: CancelID.events(projectId))
                    )
                } else {
                    state.lifecycle = .failed("Process exited with code \(code)")
                    return .merge(
                        .send(.lifecycleChanged(.failed("Process exited with code \(code)"))),
                        .cancel(id: CancelID.health(projectId)),
                        .cancel(id: CancelID.events(projectId))
                    )
                }
                
            case .stop:
                let projectId = state.projectId
                if let port = state.port {
                    portAllocator.release(port)
                    state.port = nil
                }
                state.lifecycle = .stopped
                state.snapshot = .empty
                
                return .merge(
                    .send(.lifecycleChanged(.stopped)),
                    .cancel(id: CancelID.process(projectId)),
                    .cancel(id: CancelID.health(projectId)),
                    .cancel(id: CancelID.events(projectId))
                )
                
            case .lifecycleChanged, .snapshotReceived:
                return .none
            }
        }
    }
    
}
