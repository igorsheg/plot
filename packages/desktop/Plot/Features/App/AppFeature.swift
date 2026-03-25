import ComposableArchitecture
import SwiftUI

@Reducer
struct AppFeature {
    @ObservableState
    struct State: Equatable {
        var projectList = ProjectListFeature.State()
        var detail: ProjectDetailFeature.State?
    }

    enum Action {
        case projectList(ProjectListFeature.Action)
        case detail(ProjectDetailFeature.Action)
    }

    var body: some ReducerOf<Self> {
        Scope(state: \.projectList, action: \.projectList) {
            ProjectListFeature()
        }
        Reduce { state, action in
            switch action {
            case .projectList(.delegate(.projectSelected(let project))):
                state.detail = ProjectDetailFeature.State(project: project)
                return .none

            case .projectList(.delegate(.projectDeselected)):
                state.detail = nil
                return .none

            case .projectList, .detail:
                return .none
            }
        }
        .ifLet(\.detail, action: \.detail) {
            ProjectDetailFeature()
        }
    }
}
