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
            Tab(DetailTab.tracker.rawValue, systemImage: DetailTab.tracker.systemImage, value: .tracker) {
                Form {
                    Section("Integration") {
                        Picker("Kind", selection: trackerKindBinding) {
                            ForEach(trackerKinds, id: \.self) { kind in
                                Text(kind).tag(kind)
                            }
                        }
                        .help("The issue tracker integration to use")
                    }

                    Section("States") {
                        TokenField(
                            "Dispatch",
                            tokens: Binding(
                                get: { config.tracker?.dispatchStates ?? [] },
                                set: { config.tracker?.dispatchStates = $0; sync() }
                            )
                        )

                        TokenField(
                            "Terminal",
                            tokens: Binding(
                                get: { config.tracker?.terminalStates ?? [] },
                                set: { config.tracker?.terminalStates = $0; sync() }
                            )
                        )

                        TokenField(
                            "Parked",
                            tokens: Binding(
                                get: { config.tracker?.parkedStates ?? [] },
                                set: { config.tracker?.parkedStates = $0; sync() }
                            )
                        )
                    }
                }
                .formStyle(.grouped)
            }

            Tab(DetailTab.agent.rawValue, systemImage: DetailTab.agent.systemImage, value: .agent) {
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
            }

            Tab(DetailTab.instructions.rawValue, systemImage: DetailTab.instructions.systemImage, value: .instructions) {
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
            }

            Tab(DetailTab.advanced.rawValue, systemImage: DetailTab.advanced.systemImage, value: .advanced) {
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
            }
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

struct TokenField: View {
    let label: String
    @Binding var tokens: [String]
    @State private var input = ""
    @FocusState private var isFocused: Bool

    init(_ label: String, tokens: Binding<[String]>) {
        self.label = label
        self._tokens = tokens
    }

    var body: some View {
        LabeledContent(label) {
            HStack(spacing: 4) {
                ForEach(tokens, id: \.self) { token in
                    Text(token)
                        .font(.callout)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(.fill.tertiary, in: .capsule)
                        .onTapGesture {
                            withAnimation(.default) {
                                tokens.removeAll { $0 == token }
                            }
                        }
                }

                TextField("add...", text: $input)
                    .textFieldStyle(.plain)
                    .focused($isFocused)
                    .frame(minWidth: 50)
                    .onSubmit {
                        commitInput()
                    }
                    .onChange(of: input) { _, newValue in
                        if newValue.last == "," {
                            input = String(newValue.dropLast())
                            commitInput()
                        }
                    }
            }
        }
    }

    private func commitInput() {
        let trimmed = input.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty && !tokens.contains(trimmed) {
            withAnimation(.default) {
                tokens.append(trimmed)
            }
        }
        input = ""
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
