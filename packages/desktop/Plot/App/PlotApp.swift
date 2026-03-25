import AppKit
import ComposableArchitecture
import SwiftUI

@main
struct PlotApp: App {
    static let appStore = Store(initialState: AppFeature.State()) {
        AppFeature()
            ._printChanges()
    }

    @NSApplicationDelegateAdaptor(PlotAppDelegate.self) var appDelegate

    var body: some Scene {
        Window("Configure", id: "config") {
            ConfigWindowView(store: Self.appStore)
        }
        .defaultSize(width: 480, height: 420)
        .windowToolbarStyle(.unified(showsTitle: true))

        MenuBarExtra {
            MenuBarView(store: Self.appStore)
        } label: {
            let runningCount = Self.appStore.withState { state in
                state.runtimes.filter { $0.lifecycle == .streaming }.count
            }
            if runningCount > 0 {
                Label("\(runningCount)", systemImage: "diamond.fill")
            } else {
                Image(systemName: "diamond")
            }
        }
    }
}

struct ConfigWindowView: View {
    let store: StoreOf<AppFeature>

    var body: some View {
        if let detailStore = store.scope(state: \.configuring, action: \.configuring) {
            ProjectDetailView(store: detailStore)
        } else {
            ContentUnavailableView("No Project Selected", systemImage: "folder")
        }
    }
}

struct MenuBarView: View {
    let store: StoreOf<AppFeature>
    @Environment(\.openWindow) var openWindow

    var body: some View {
        let projects = store.projects
        let runtimes = store.runtimes

        let hasIdle = projects.contains {
            !(runtimes[id: $0.id]?.lifecycle.isActive ?? false)
        }
        let hasActive = projects.contains {
            runtimes[id: $0.id]?.lifecycle.isActive ?? false
        }

        if !projects.isEmpty {
            if hasIdle {
                Button("Start All") {
                    for project in projects where !(runtimes[id: project.id]?.lifecycle.isActive ?? false) {
                        store.send(.toggleProject(project.id))
                    }
                }
            }
            if hasActive {
                Button("Stop All") {
                    for project in projects where runtimes[id: project.id]?.lifecycle.isActive ?? false {
                        store.send(.toggleProject(project.id))
                    }
                }
            }

            Divider()

            ForEach(projects) { project in
                let runtime = runtimes[id: project.id]
                let lifecycle = runtime?.lifecycle ?? .idle

                Menu {
                    Button("Configure...") {
                        store.send(.configure(project.id))
                        openWindow(id: "config")
                    }
                    Button(lifecycle.isActive ? "Stop" : "Start") {
                        store.send(.toggleProject(project.id))
                    }
                    Button("Show in Finder") {
                        NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: project.path)
                    }
                    Divider()
                    Button("Remove") {
                        store.send(.removeProject(project.id))
                    }
                } label: {
                    HStack {
                        Text(project.name)
                        Spacer()
                        if let text = statusText(for: lifecycle, runtime: runtime) {
                            Text(text)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Divider()
        }

        Button("Add Project...") {
            NSApp.activate(ignoringOtherApps: true)
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            panel.allowsMultipleSelection = false
            if panel.runModal() == .OK, let url = panel.url {
                store.send(.addProject(url.path))
                openWindow(id: "config")
            }
        }

        Divider()

        Button("Quit Plot") {
            NSApplication.shared.terminate(nil)
        }
        .keyboardShortcut("q")
    }

    private func statusText(for lifecycle: ProjectLifecycle, runtime: ProjectRuntimeFeature.State?) -> String? {
        switch lifecycle {
        case .streaming:
            if let runtime, !runtime.snapshot.running.isEmpty {
                let count = runtime.snapshot.running.count
                return "\(count) agent\(count == 1 ? "" : "s")"
            }
            return "Running"
        case .launching, .connecting:
            return "Starting..."
        case .stopping:
            return "Stopping..."
        case .failed:
            return "Error"
        case .idle, .stopped:
            return nil
        }
    }
}
