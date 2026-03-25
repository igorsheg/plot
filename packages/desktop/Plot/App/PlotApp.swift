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
        Window("Plot", id: "main") {
            AppView(store: Self.appStore)
        }
        .defaultSize(width: 800, height: 600)
        .windowToolbarStyle(.unified(showsTitle: true))
        .commands {
            CommandGroup(after: .newItem) {
                Button("New Project") {
                    Self.appStore.send(.projectList(.addProjectTapped))
                }
                .keyboardShortcut("n")
            }
        }

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

        let hasIdle = projects.contains { project in
            let lifecycle = runtimes[id: project.id]?.lifecycle ?? .idle
            return !lifecycle.isActive
        }
        let hasActive = projects.contains { project in
            let lifecycle = runtimes[id: project.id]?.lifecycle ?? .idle
            return lifecycle.isActive
        }

        if !projects.isEmpty {
            if hasIdle {
                Button("Start All") {
                    for project in projects {
                        let lifecycle = runtimes[id: project.id]?.lifecycle ?? .idle
                        if !lifecycle.isActive {
                            store.send(.projectList(.toggleProject(project.id)))
                        }
                    }
                }
            }
            if hasActive {
                Button("Stop All") {
                    for project in projects {
                        let lifecycle = runtimes[id: project.id]?.lifecycle ?? .idle
                        if lifecycle.isActive {
                            store.send(.projectList(.toggleProject(project.id)))
                        }
                    }
                }
            }

            Divider()

            ForEach(projects) { project in
                let runtime = runtimes[id: project.id]
                let lifecycle = runtime?.lifecycle ?? .idle

                Button {
                    store.send(.projectList(.toggleProject(project.id)))
                } label: {
                    HStack {
                        Image(systemName: "circle.fill")
                            .foregroundStyle(statusColor(for: lifecycle))
                            .font(.system(size: 8))
                        Text(project.name)
                        Spacer()
                        if lifecycle == .streaming,
                           let tokens = runtime?.snapshot.codexTotals.totalTokens,
                           tokens > 0 {
                            Text(formatTokens(tokens))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            let totalTokens = runtimes
                .filter { $0.lifecycle == .streaming }
                .reduce(0) { $0 + $1.snapshot.codexTotals.totalTokens }

            if totalTokens > 0 {
                Divider()
                Text("Total: \(formatTokens(totalTokens))")
                    .foregroundStyle(.secondary)
            }
        } else {
            Text("No projects")
                .foregroundStyle(.secondary)
        }
    }

    private func statusColor(for lifecycle: ProjectLifecycle) -> Color {
        switch lifecycle {
        case .streaming: return .green
        case .launching, .connecting: return .orange
        case .stopping: return .yellow
        case .failed: return .red
        case .idle, .stopped: return .secondary
        }
    }

    private func formatTokens(_ count: Int) -> String {
        if count >= 1_000_000 {
            return String(format: "%.1fM tok", Double(count) / 1_000_000)
        } else if count >= 1_000 {
            return String(format: "%.1fk tok", Double(count) / 1_000)
        }
        return "\(count) tok"
    }
}
