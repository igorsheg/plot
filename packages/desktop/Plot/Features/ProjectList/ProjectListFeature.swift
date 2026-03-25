import AppKit
import ComposableArchitecture
import Foundation

@Reducer
struct ProjectListFeature {
    @ObservableState
    struct State: Equatable {
        var projects: IdentifiedArrayOf<Project> = []
        var runtimeStates: [Project.ID: ProjectLifecycle] = [:]
        var snapshots: [Project.ID: RuntimeSnapshot] = [:]
    }
    
    @CasePathable
    enum Action {
        case task
        case projectsLoaded([Project])
        case addProjectTapped
        case folderSelected(String)
        case removeProject(Project.ID)
        case toggleProject(Project.ID)
        case delegate(Delegate)
        case runtime(Project.ID, ProjectRuntimeFeature.Action)
        
        @CasePathable
        enum Delegate {
            case projectSelected(Project)
        }
    }
    
    @Dependency(\.projectStore) var projectStore
    @Dependency(\.fileClient) var fileClient
    
    var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .task:
                return .run { send in
                    let projects = try await projectStore.load()
                    await send(.projectsLoaded(projects))
                }
                
            case .projectsLoaded(let projects):
                state.projects = IdentifiedArray(uniqueElements: projects)
                return .none
                
            case .addProjectTapped:
                return .run { send in
                    let url: URL? = await MainActor.run {
                        let panel = NSOpenPanel()
                        panel.canChooseDirectories = true
                        panel.canChooseFiles = false
                        panel.allowsMultipleSelection = false
                        let result = panel.runModal()
                        if result == .OK { return panel.url }
                        return nil
                    }
                    if let url {
                        await send(.folderSelected(url.path))
                    }
                }
                
            case .folderSelected(let path):
                let project = Project(path: path)
                guard state.projects[id: project.id] == nil else { return .none }
                guard !state.projects.contains(where: { $0.path == path }) else { return .none }
                state.projects.append(project)
                return .run { [projects = state.projects] _ in
                    try await projectStore.save(Array(projects))
                }
                
            case .removeProject(let id):
                state.projects.remove(id: id)
                state.runtimeStates.removeValue(forKey: id)
                state.snapshots.removeValue(forKey: id)
                return .run { [projects = state.projects] _ in
                    try await projectStore.save(Array(projects))
                }
                
            case .toggleProject(let id):
                guard let project = state.projects[id: id] else { return .none }
                let lifecycle = state.runtimeStates[id] ?? .idle
                if lifecycle.isActive {
                    return .send(.runtime(id, .stop))
                } else {
                    return .send(.runtime(id, .start(project.path)))
                }
                
            case .delegate:
                return .none
                
            case .runtime(let id, .lifecycleChanged(let lifecycle)):
                state.runtimeStates[id] = lifecycle
                return .none
                
            case .runtime(let id, .snapshotReceived(let snapshot)):
                state.snapshots[id] = snapshot
                return .none
                
            case .runtime:
                return .none
            }
        }
    }
}
