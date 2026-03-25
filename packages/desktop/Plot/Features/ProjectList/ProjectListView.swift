import ComposableArchitecture
import SwiftUI

struct ProjectListView: View {
    let store: StoreOf<ProjectListFeature>

    var body: some View {
        List {
            ForEach(store.projects) { project in
                ProjectRowView(
                    project: project,
                    lifecycle: store.runtimeStates[project.id] ?? .idle,
                    snapshot: store.snapshots[project.id],
                    onTap: { store.send(.delegate(.projectSelected(project))) },
                    onToggle: { store.send(.toggleProject(project.id)) }
                )
                .contextMenu {
                    Button("Remove Project") {
                        store.send(.removeProject(project.id))
                    }
                }
            }
        }
        .navigationTitle("Plot")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    store.send(.addProjectTapped)
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .overlay {
            if store.projects.isEmpty {
                EmptyProjectsView {
                    store.send(.addProjectTapped)
                }
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
    let onTap: () -> Void
    let onToggle: () -> Void

    var body: some View {
        Button(action: onTap) {
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
                        .foregroundStyle(.primary)

                    HStack(spacing: 6) {
                        Circle()
                            .fill(statusColor)
                            .frame(width: 6, height: 6)

                        Text(statusLabel)
                            .font(.caption)
                            .foregroundStyle(.secondary)
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
        .buttonStyle(.plain)
    }

    private var statusLabel: String {
        if lifecycle == .streaming, let snapshot {
            let agentCount = snapshot.running.count
            let tokens = snapshot.codexTotals.totalTokens
            if agentCount > 0 {
                return "\(agentCount) agent\(agentCount == 1 ? "" : "s") · \(formatTokens(tokens))"
            }
            return lifecycle.label
        }
        return lifecycle.label
    }

    private var statusColor: Color {
        switch lifecycle {
        case .idle, .stopped: return .secondary
        case .launching, .connecting: return .orange
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

            Text("Get started with Plot")
                .font(.headline)

            Text("Point Plot at a repo and it'll orchestrate\ncoding agents against your issue tracker.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button("Open a Project Folder", action: onAdd)
                .buttonStyle(.borderedProminent)
                .controlSize(.regular)
        }
    }
}
