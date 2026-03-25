import ComposableArchitecture
import SwiftUI

@main
struct PlotApp: App {
    static let appStore = Store(initialState: AppFeature.State()) {
        AppFeature()
    }

    @NSApplicationDelegateAdaptor(PlotAppDelegate.self) var appDelegate

    var body: some Scene {
        Window("Plot", id: "main") {
            AppView(store: Self.appStore)
        }
        .defaultSize(width: 520, height: 680)

        MenuBarExtra {
            MenuBarContentView(store: Self.appStore)

            Divider()

            Button("Open Plot") {
                appDelegate.showMainWindow()
            }
            .keyboardShortcut("o")

            Divider()

            Button("Quit Plot") {
                NSApplication.shared.terminate(nil)
            }
            .keyboardShortcut("q")
        } label: {
            let runningCount = Self.appStore.withState { state in
                state.projectList.runtimes.filter { $0.lifecycle == .streaming }.count
            }
            if runningCount > 0 {
                Label("\(runningCount)", systemImage: "diamond.fill")
            } else {
                Image(systemName: "diamond")
            }
        }
    }
}

struct MenuBarContentView: View {
    let store: StoreOf<AppFeature>

    var body: some View {
        let projects = store.projectList.projects
        let runtimes = store.projectList.runtimes

        if projects.isEmpty {
            Text("No projects")
                .foregroundStyle(.secondary)
        } else {
            ForEach(projects) { project in
                let runtime = runtimes[id: project.id]
                let lifecycle = runtime?.lifecycle ?? .idle

                Button {
                    store.send(.projectList(.toggleProject(project.id)))
                } label: {
                    HStack {
                        Text(project.name)
                        Spacer()
                        if lifecycle == .streaming, let snapshot = runtime?.snapshot, !snapshot.running.isEmpty {
                            Text("\(snapshot.running.count) agents")
                                .foregroundStyle(.secondary)
                        }
                        Text(lifecycle.isActive ? "●" : "○")
                            .foregroundStyle(lifecycle.isActive ? .green : .secondary)
                    }
                }
            }
        }
    }
}
