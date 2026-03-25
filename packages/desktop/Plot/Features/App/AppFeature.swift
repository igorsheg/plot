import ComposableArchitecture
import Foundation

@Reducer
struct AppFeature {
    @ObservableState
    struct State: Equatable {
        var projects: IdentifiedArrayOf<Project> = []
        var runtimes: IdentifiedArrayOf<ProjectRuntimeFeature.State> = []
        var configuring: ProjectDetailFeature.State?
    }

    enum Action {
        case task
        case projectsLoaded([Project])
        case addProject(String)
        case removeProject(Project.ID)
        case toggleProject(Project.ID)
        case configure(Project.ID)
        case configuring(ProjectDetailFeature.Action)
        case runtime(IdentifiedActionOf<ProjectRuntimeFeature>)
    }

    @Dependency(\.projectStore) var projectStore
    @Dependency(\.processClient) var processClient

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
                for project in projects {
                    if state.runtimes[id: project.id] == nil {
                        state.runtimes.append(ProjectRuntimeFeature.State(projectId: project.id))
                    }
                }
                return .none

            case .addProject(let path):
                let project = Project(path: path)
                guard !state.projects.contains(where: { $0.path == path }) else { return .none }
                state.projects.append(project)
                state.runtimes.append(ProjectRuntimeFeature.State(projectId: project.id))
                state.configuring = ProjectDetailFeature.State(project: project)
                return .run { [projects = state.projects] _ in
                    try await projectStore.save(Array(projects))
                }

            case .removeProject(let id):
                state.projects.remove(id: id)
                state.runtimes.remove(id: id)
                if state.configuring?.project.id == id {
                    state.configuring = nil
                }
                return .run { [projects = state.projects] _ in
                    await processClient.terminate(id)
                    try await projectStore.save(Array(projects))
                }

            case .toggleProject(let id):
                guard let project = state.projects[id: id] else { return .none }
                let lifecycle = state.runtimes[id: id]?.lifecycle ?? .idle
                if lifecycle.isActive {
                    return .send(.runtime(.element(id: id, action: .stop)))
                } else {
                    return .send(.runtime(.element(id: id, action: .start(project.path))))
                }

            case .configure(let id):
                guard let project = state.projects[id: id] else { return .none }
                state.configuring = ProjectDetailFeature.State(project: project)
                return .none

            case .configuring, .runtime:
                return .none
            }
        }
        .forEach(\.runtimes, action: \.runtime) {
            ProjectRuntimeFeature()
        }
        .ifLet(\.configuring, action: \.configuring) {
            ProjectDetailFeature()
        }
    }
}
