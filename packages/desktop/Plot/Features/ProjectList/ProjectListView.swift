import ComposableArchitecture
import SwiftUI
import UniformTypeIdentifiers

struct ProjectListView: View {
    @Bindable var store: StoreOf<ProjectListFeature>

    var body: some View {
        Group {
            if store.projects.isEmpty {
                EmptyProjectsView {
                    store.send(.addProjectTapped)
                }
            } else {
                List(selection: $store.selectedProjectId) {
                    ForEach(store.projects) { project in
                        let lifecycle = store.runtimes[id: project.id]?.lifecycle ?? .idle
                        let snapshot = store.runtimes[id: project.id]?.snapshot

                        ProjectRowView(
                            project: project,
                            lifecycle: lifecycle,
                            snapshot: snapshot,
                            onToggle: { store.send(.toggleProject(project.id)) }
                        )
                        .tag(project.id)
                        .contentShape(.rect)
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                store.send(.removeProject(project.id))
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                        .contextMenu {
                            Button(lifecycle.isActive ? "Stop" : "Start") {
                                store.send(.toggleProject(project.id))
                            }
                            Button("Show in Finder") {
                                NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: project.path)
                            }
                            Divider()
                            Button("Remove Project", role: .destructive) {
                                store.send(.removeProject(project.id))
                            }
                        }
                    }
                }
                .listStyle(.sidebar)
                .animation(.default, value: store.projects.count)
                .onDeleteCommand {
                    if let id = store.selectedProjectId {
                        store.send(.removeProject(id))
                    }
                }
                .onDrop(of: [.fileURL], isTargeted: nil) { providers in
                    for provider in providers {
                        _ = provider.loadObject(ofClass: URL.self) { url, _ in
                            guard let url else { return }
                            var isDir: ObjCBool = false
                            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir),
                                  isDir.boolValue else { return }
                            DispatchQueue.main.async {
                                store.send(.folderSelected(url.path))
                            }
                        }
                    }
                    return true
                }
            }
        }
        .navigationTitle("Projects")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    store.send(.addProjectTapped)
                } label: {
                    Image(systemName: "plus")
                }
                .keyboardShortcut("n", modifiers: .command)
            }
        }
        .task {
            store.send(.task)
        }
    }
}

struct ProjectRowView: View {
    let project: Project
    let lifecycle: ProjectLifecycle
    let snapshot: RuntimeSnapshot?
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 6)
                .fill(avatarColor)
                .frame(width: 28, height: 28)
                .overlay {
                    Text(String(project.name.prefix(1)).uppercased())
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white)
                }

            VStack(alignment: .leading, spacing: 2) {
                Text(project.name)
                    .font(.body)

                HStack(spacing: 6) {
                    Image(systemName: "circle.fill")
                        .font(.system(size: 7))
                        .foregroundStyle(statusColor)
                        .symbolEffect(.pulse, isActive: lifecycle == .streaming)

                    statusText
                }
            }

            Spacer()

            Button(action: onToggle) {
                Image(systemName: lifecycle.isActive ? "stop.fill" : "play.fill")
                    .font(.caption)
                    .foregroundStyle(lifecycle.isActive ? .red : .green)
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private var statusText: some View {
        if lifecycle == .streaming, let snapshot, snapshot.running.count > 0 {
            let tokens = snapshot.codexTotals.totalTokens
            let agentCount = snapshot.running.count
            Text("\(agentCount) agent\(agentCount == 1 ? "" : "s") · \(formatTokens(tokens))")
                .font(.caption)
                .foregroundStyle(.secondary)
                .contentTransition(.numericText())
                .animation(.default, value: tokens)
        } else {
            Text(statusLabel)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var statusLabel: String {
        if case .failed(let message) = lifecycle {
            return message
        }
        return lifecycle.label
    }

    private var statusColor: Color {
        switch lifecycle {
        case .idle, .stopped: return .secondary
        case .launching, .connecting, .stopping: return .orange
        case .streaming: return .green
        case .failed: return .red
        }
    }

    private var avatarColor: Color {
        let colors: [Color] = [.blue, .purple, .green, .orange, .pink, .cyan]
        var hash = 0
        for char in project.name.unicodeScalars {
            hash = (hash &<< 5) &- hash &+ Int(char.value)
        }
        return colors[abs(hash) % colors.count]
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

struct EmptyProjectsView: View {
    let onAdd: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "folder.badge.plus")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
                .symbolEffect(.bounce, options: .repeating.speed(0.5))

            Text("Get started with Plot")
                .font(.headline)

            Text("Point Plot at a repo and it'll orchestrate\ncoding agents against your issue tracker.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button("Open a Project Folder", action: onAdd)
                .buttonStyle(.borderedProminent)
                .controlSize(.regular)

            Spacer()
                .frame(height: 24)

            Text("Plot v0.1.0")
                .font(.caption2)
                .foregroundStyle(.quaternary)
        }
    }
}
