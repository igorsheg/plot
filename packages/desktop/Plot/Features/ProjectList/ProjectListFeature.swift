import AppKit
import ComposableArchitecture
import Foundation

@Reducer
struct ProjectListFeature {
    @ObservableState
    struct State: Equatable {
        var projects: IdentifiedArrayOf<Project> = []
        var runtimes: IdentifiedArrayOf<ProjectRuntimeFeature.State> = []
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
        case runtime(IdentifiedActionOf<ProjectRuntimeFeature>)
        
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
                // Ensure each project has a runtime state
                for project in projects {
                    if state.runtimes[id: project.id] == nil {
                        state.runtimes.append(ProjectRuntimeFeature.State(projectId: project.id))
                    }
                }
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
                guard !state.projects.contains(where: { $0.path == path }) else { return .none }
                state.projects.append(project)
                state.runtimes.append(ProjectRuntimeFeature.State(projectId: project.id))
                return .run { [projects = state.projects] _ in
                    try await projectStore.save(Array(projects))
                }
                
            case .removeProject(let id):
                state.projects.remove(id: id)
                state.runtimes.remove(id: id)
                return .run { [projects = state.projects] _ in
                    try await projectStore.save(Array(projects))
                }
                
            case .toggleProject(let id):
                guard let project = state.projects[id: id] else { return .none }
                let runtime = state.runtimes[id: id]
                let lifecycle = runtime?.lifecycle ?? .idle
                if lifecycle.isActive {
                    return .send(.runtime(.element(id: id, action: .stop)))
                } else {
                    return .send(.runtime(.element(id: id, action: .start(project.path))))
                }
                
            case .delegate:
                return .none
                
            case .runtime:
                return .none
            }
        }
        .forEach(\.runtimes, action: \.runtime) {
            ProjectRuntimeFeature()
        }
    }
}
