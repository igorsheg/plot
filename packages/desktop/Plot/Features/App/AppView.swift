import ComposableArchitecture
import SwiftUI

struct AppView: View {
    @Bindable var store: StoreOf<AppFeature>

    var body: some View {
        NavigationSplitView {
            ProjectListView(store: store.scope(state: \.projectList, action: \.projectList))
        } detail: {
            if let detailStore = store.scope(state: \.detail, action: \.detail) {
                ProjectDetailView(store: detailStore)
            } else {
                DetailPlaceholderView()
            }
        }
        .frame(minWidth: 720, minHeight: 520)
    }
}

struct DetailPlaceholderView: View {
    var body: some View {
        ContentUnavailableView {
            Label("Select a Project", systemImage: "folder")
        } description: {
            Text("Choose a project from the sidebar to view and configure its workflow.")
        }
    }
}
