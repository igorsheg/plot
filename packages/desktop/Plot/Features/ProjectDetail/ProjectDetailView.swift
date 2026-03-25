import ComposableArchitecture
import SwiftUI

struct ProjectDetailView: View {
    @Bindable var store: StoreOf<ProjectDetailFeature>

    var body: some View {
        Group {
            if store.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let workflow = store.workflow {
                WorkflowFormView(
                    workflow: workflow,
                    onUpdateFrontmatter: { store.send(.updateFrontmatter($0)) },
                    onSave: { store.send(.save) },
                    onOpenInEditor: { store.send(.openInEditor) }
                )
            } else {
                NoWorkflowView(
                    onCreate: { store.send(.createWorkflow($0)) }
                )
            }
        }
        .navigationTitle(store.project.name)
        .task {
            store.send(.task)
        }
    }
}

struct WorkflowFormView: View {
    let workflow: WorkflowDocument
    let onUpdateFrontmatter: (WorkflowFrontmatter) -> Void
    let onSave: () -> Void
    let onOpenInEditor: () -> Void

    @State private var config: WorkflowFrontmatter

    init(
        workflow: WorkflowDocument,
        onUpdateFrontmatter: @escaping (WorkflowFrontmatter) -> Void,
        onSave: @escaping () -> Void,
        onOpenInEditor: @escaping () -> Void
    ) {
        self.workflow = workflow
        self.onUpdateFrontmatter = onUpdateFrontmatter
        self.onSave = onSave
        self.onOpenInEditor = onOpenInEditor
        self._config = State(initialValue: workflow.config)
    }

    private let trackerKinds = ["github", "beads"]
    private let modelOptions = ["anthropic/claude-sonnet-4-20250514", "anthropic/claude-opus-4-6"]

    var body: some View {
        Form {
            Section("Tracker") {
                Picker("Kind", selection: trackerKindBinding) {
                    ForEach(trackerKinds, id: \.self) { kind in
                        Text(kind).tag(kind)
                    }
                }

                TagField(
                    label: "Dispatch States",
                    tags: config.tracker?.dispatchStates ?? [],
                    onChange: { config.tracker?.dispatchStates = $0; sync() }
                )

                TagField(
                    label: "Terminal States",
                    tags: config.tracker?.terminalStates ?? [],
                    onChange: { config.tracker?.terminalStates = $0; sync() }
                )

                TagField(
                    label: "Parked States",
                    tags: config.tracker?.parkedStates ?? [],
                    onChange: { config.tracker?.parkedStates = $0; sync() }
                )
            }

            Section("Agent") {
                Picker("Model", selection: agentModelBinding) {
                    ForEach(modelOptions, id: \.self) { model in
                        Text(model).tag(model)
                    }
                }

                TextField(
                    "Max Concurrent Agents",
                    value: Binding(
                        get: { config.agent?.maxConcurrentAgents },
                        set: { config.agent?.maxConcurrentAgents = $0; sync() }
                    ),
                    format: .number
                )

                TextField(
                    "Max Turns",
                    value: Binding(
                        get: { config.agent?.maxTurns },
                        set: { config.agent?.maxTurns = $0; sync() }
                    ),
                    format: .number
                )
            }

            Section("Workspace") {
                TextField(
                    "Root",
                    text: Binding(
                        get: { config.workspace?.root ?? "" },
                        set: {
                            if config.workspace == nil { config.workspace = .init() }
                            config.workspace?.root = $0.isEmpty ? nil : $0
                            sync()
                        }
                    )
                )
            }

            Section("Agent Instructions") {
                Button("Open WORKFLOW.md in Editor") {
                    onOpenInEditor()
                }

                if !workflow.promptBody.isEmpty {
                    Text(workflow.promptBody)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(5)
                }
            }
        }
        .formStyle(.grouped)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Save") { onSave() }
            }
        }
    }

    private func sync() {
        onUpdateFrontmatter(config)
    }

    private var trackerKindBinding: Binding<String> {
        Binding(
            get: { config.tracker?.kind ?? "github" },
            set: {
                if config.tracker == nil { config.tracker = .init(kind: $0) }
                else { config.tracker?.kind = $0 }
                sync()
            }
        )
    }
    
    private var agentModelBinding: Binding<String> {
        Binding(
            get: { config.agent?.model ?? "anthropic/claude-sonnet-4-20250514" },
            set: {
                if config.agent == nil { config.agent = .init(model: $0) }
                else { config.agent?.model = $0 }
                sync()
            }
        )
    }
}

struct TagField: View {
    let label: String
    let tags: [String]
    let onChange: ([String]) -> Void

    @State private var input = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)

            FlowLayout(spacing: 4) {
                ForEach(tags, id: \.self) { tag in
                    HStack(spacing: 2) {
                        Text(tag)
                            .font(.caption)
                        Button {
                            onChange(tags.filter { $0 != tag })
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 8))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.quaternary)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                }
            }

            TextField("Add tag, press Enter", text: $input)
                .textFieldStyle(.plain)
                .font(.caption)
                .onSubmit {
                    let trimmed = input.trimmingCharacters(in: .whitespaces)
                    if !trimmed.isEmpty && !tags.contains(trimmed) {
                        onChange(tags + [trimmed])
                    }
                    input = ""
                }
        }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var maxX: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            maxX = max(maxX, x)
        }

        return (CGSize(width: maxX, height: y + rowHeight), positions)
    }
}

struct NoWorkflowView: View {
    let onCreate: (ProjectDetailFeature.WorkflowTemplate) -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "doc.badge.plus")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)

            Text("No workflow configured")
                .font(.headline)

            Text("Create a WORKFLOW.md to start\norchestrating agents.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            VStack(spacing: 8) {
                Button("GitHub Issues Template") {
                    onCreate(.github)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.regular)

                Button("Beads Template") {
                    onCreate(.beads)
                }
                .controlSize(.regular)

                Button("Start from Scratch") {
                    onCreate(.blank)
                }
                .buttonStyle(.plain)
                .font(.caption)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
