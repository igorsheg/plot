import ComposableArchitecture
import SwiftUI

struct AppView: View {
    @Bindable var store: StoreOf<AppFeature>

    var body: some View {
        NavigationStack(path: $store.scope(state: \.path, action: \.path)) {
            ProjectListView(store: store.scope(state: \.projectList, action: \.projectList))
        } destination: { store in
            switch store.case {
            case .detail(let store):
                ProjectDetailView(store: store)
            }
        }
        .frame(minWidth: 480, minHeight: 500)
    }
}
