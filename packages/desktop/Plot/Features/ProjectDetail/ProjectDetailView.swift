import ComposableArchitecture
import SwiftUI

struct ProjectDetailView: View {
    @Bindable var store: StoreOf<ProjectDetailFeature>

    var body: some View {
        Group {
            if store.isLoading {
                ProgressView("Loading workflow...")
                    .controlSize(.small)
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
    @State private var showSaveConfirmation = false

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

    @State private var selectedTab: DetailTab = .tracker

    enum DetailTab: String, CaseIterable {
        case tracker = "Tracker"
        case agent = "Agent"
        case instructions = "Instructions"
        case advanced = "Advanced"

        var systemImage: String {
            switch self {
            case .tracker: return "antenna.radiowaves.left.and.right"
            case .agent: return "cpu"
            case .instructions: return "doc.text"
            case .advanced: return "gearshape"
            }
        }
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            Form {
                Picker("Kind", selection: trackerKindBinding) {
                    ForEach(trackerKinds, id: \.self) { kind in
                        Text(kind).tag(kind)
                    }
                }
                .help("The issue tracker integration to use")

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
            .formStyle(.grouped)
            .tabItem { Label(DetailTab.tracker.rawValue, systemImage: DetailTab.tracker.systemImage) }
            .tag(DetailTab.tracker)

            Form {
                Picker("Model", selection: agentModelBinding) {
                    ForEach(modelOptions, id: \.self) { model in
                        Text(model).tag(model)
                    }
                }
                .help("The AI model to use for coding agents")

                TextField(
                    "Max Concurrent Agents",
                    value: Binding(
                        get: { config.agent?.maxConcurrentAgents },
                        set: { config.agent?.maxConcurrentAgents = $0; sync() }
                    ),
                    format: .number
                )
                .help("Maximum number of agents running simultaneously")

                TextField(
                    "Max Turns",
                    value: Binding(
                        get: { config.agent?.maxTurns },
                        set: { config.agent?.maxTurns = $0; sync() }
                    ),
                    format: .number
                )
                .help("Maximum conversation turns per agent session")
            }
            .formStyle(.grouped)
            .tabItem { Label(DetailTab.agent.rawValue, systemImage: DetailTab.agent.systemImage) }
            .tag(DetailTab.agent)

            Form {
                Section {
                    Button {
                        onOpenInEditor()
                    } label: {
                        Label("Open WORKFLOW.md in Editor", systemImage: "pencil.and.outline")
                    }
                    .buttonStyle(.borderedProminent)
                }

                if !workflow.promptBody.isEmpty {
                    Section("Preview") {
                        Text(workflow.promptBody)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .formStyle(.grouped)
            .tabItem { Label(DetailTab.instructions.rawValue, systemImage: DetailTab.instructions.systemImage) }
            .tag(DetailTab.instructions)

            Form {
                TextField(
                    "Workspace Root",
                    text: Binding(
                        get: { config.workspace?.root ?? "" },
                        set: {
                            if config.workspace == nil { config.workspace = .init() }
                            config.workspace?.root = $0.isEmpty ? nil : $0
                            sync()
                        }
                    )
                )
                .help("Working directory for agent workspaces, relative to the project root")
            }
            .formStyle(.grouped)
            .tabItem { Label(DetailTab.advanced.rawValue, systemImage: DetailTab.advanced.systemImage) }
            .tag(DetailTab.advanced)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showSaveConfirmation = true
                    onSave()
                } label: {
                    Label(
                        showSaveConfirmation ? "Saved" : "Save",
                        systemImage: showSaveConfirmation ? "checkmark.circle.fill" : "square.and.arrow.down"
                    )
                    .symbolEffect(.bounce, value: showSaveConfirmation)
                }
                .sensoryFeedback(.success, trigger: showSaveConfirmation)
                .task(id: showSaveConfirmation) {
                    guard showSaveConfirmation else { return }
                    try? await Task.sleep(for: .seconds(2))
                    showSaveConfirmation = false
                }
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
                            .foregroundStyle(Color.accentColor)
                        Button {
                            onChange(tags.filter { $0 != tag })
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 8))
                                .foregroundStyle(Color.accentColor.opacity(0.7))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.accentColor.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .transition(.scale.combined(with: .opacity))
                }
            }
            .animation(.bouncy, value: tags.count)

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

    struct TemplateCard: Identifiable {
        let id: ProjectDetailFeature.WorkflowTemplate
        let title: String
        let description: String
        let systemImage: String
    }

    private let templates: [TemplateCard] = [
        TemplateCard(id: .github, title: "GitHub Issues", description: "Track work via GitHub Issues", systemImage: "list.bullet.rectangle"),
        TemplateCard(id: .beads, title: "Beads", description: "Use the Beads task tracker", systemImage: "circle.hexagongrid"),
        TemplateCard(id: .blank, title: "Blank", description: "Start with an empty workflow", systemImage: "doc"),
    ]

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "doc.badge.plus")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)

            Text("No workflow configured")
                .font(.headline)

            Text("Create a WORKFLOW.md to start\norchestrating agents.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                ForEach(templates) { template in
                    TemplateCardButton(template: template) {
                        onCreate(template.id)
                    }
                }
            }
            .padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct TemplateCardButton: View {
    let template: NoWorkflowView.TemplateCard
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: template.systemImage)
                    .font(.title2)
                    .foregroundStyle(Color.accentColor)
                    .symbolEffect(.bounce, value: isHovering)

                Text(template.title)
                    .font(.headline)

                Text(template.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .padding(.horizontal, 12)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(NSColor.controlBackgroundColor))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(.quaternary)
            )
            .scaleEffect(isHovering ? 1.02 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: isHovering)
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
    }
}
