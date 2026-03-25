import ComposableArchitecture
import SwiftUI

@Reducer
struct AppFeature {
    @Reducer
    enum Path {
        case detail(ProjectDetailFeature)
    }
    
    @ObservableState
    struct State: Equatable {
        var path = StackState<Path.State>()
        var projectList = ProjectListFeature.State()
    }
    
    enum Action {
        case path(StackActionOf<Path>)
        case projectList(ProjectListFeature.Action)
    }
    
    var body: some ReducerOf<Self> {
        Scope(state: \.projectList, action: \.projectList) {
            ProjectListFeature()
        }
        Reduce { state, action in
            switch action {
            case .projectList(.delegate(.projectSelected(let project))):
                state.path.append(.detail(ProjectDetailFeature.State(project: project)))
                return .none
                
            case .path, .projectList:
                return .none
            }
        }
        .forEach(\.path, action: \.path)
    }
}

extension AppFeature.Path.State: Equatable {}
