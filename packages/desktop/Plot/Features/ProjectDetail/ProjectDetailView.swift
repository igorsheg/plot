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
            } else if store.workflow != nil {
                WorkflowFormView(store: store)
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
    @Bindable var store: StoreOf<ProjectDetailFeature>

    @State private var config: WorkflowFrontmatter
    @State private var showSaveConfirmation = false
    @State private var selectedTab: DetailTab = .tracker

    private let trackerKinds = ["github", "beads"]

    init(store: StoreOf<ProjectDetailFeature>) {
        self.store = store
        self._config = State(initialValue: store.workflow?.config ?? WorkflowFrontmatter())
    }

    enum DetailTab: String, CaseIterable {
        case tracker = "Tracker"
        case agent = "Agent"
        case advanced = "Advanced"

        var systemImage: String {
            switch self {
            case .tracker: return "antenna.radiowaves.left.and.right"
            case .agent: return "cpu"
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

                    Section("Instructions") {
                        Button {
                            store.send(.openInEditor)
                        } label: {
                            Label("Open WORKFLOW.md in Editor", systemImage: "pencil.and.outline")
                        }
                        .buttonStyle(.borderedProminent)

                        if let body = store.workflow?.promptBody, !body.isEmpty {
                            Text(body)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .formStyle(.grouped)
            }

            Tab(DetailTab.agent.rawValue, systemImage: DetailTab.agent.systemImage, value: .agent) {
                Form {
                    Section("Provider") {
                        if let registry = store.modelRegistry {
                            Picker("Provider", selection: providerBinding) {
                                ForEach(registry.providers) { provider in
                                    Text(provider.id).tag(provider.id)
                                }
                            }

                            AuthStatusView(
                                isAuthenticated: store.isProviderAuthenticated,
                                authState: store.authState,
                                providerName: store.selectedProviderId ?? "",
                                onLogin: { store.send(.loginTapped) }
                            )
                        } else {
                            ProgressView("Loading providers...")
                                .controlSize(.small)
                        }
                    }

                    Section("Model") {
                        if let provider = store.selectedProvider {
                            Picker("Model", selection: modelBinding) {
                                ForEach(provider.models) { model in
                                    Text(model.name).tag(model.id)
                                }
                            }
                            .help("The AI model to use for coding agents")
                        } else {
                            Text("Select a provider first")
                                .foregroundStyle(.secondary)
                        }
                    }

                    Section("Limits") {
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
                    store.send(.save)
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
        store.send(.updateFrontmatter(config))
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

    private var providerBinding: Binding<String> {
        Binding(
            get: { store.selectedProviderId ?? "" },
            set: { store.send(.selectProvider($0)) }
        )
    }

    private var modelBinding: Binding<String> {
        Binding(
            get: { store.selectedModelId ?? "" },
            set: { store.send(.selectModel($0)) }
        )
    }
}

struct AuthStatusView: View {
    let isAuthenticated: Bool
    let authState: ProjectDetailFeature.State.AuthState
    let providerName: String
    let onLogin: () -> Void

    var body: some View {
        switch authState {
        case .idle:
            if isAuthenticated {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text("Authenticated")
                        .foregroundStyle(.secondary)
                }
            } else {
                Button(action: onLogin) {
                    Label("Log in with \(providerName)", systemImage: "person.badge.key")
                }
                .buttonStyle(.borderedProminent)
            }
        case .authenticating:
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text("Authenticating...")
                    .foregroundStyle(.secondary)
            }
        case .waitingForCode(let message, _):
            VStack(alignment: .leading, spacing: 8) {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Text("Complete authentication in your browser")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        case .success:
            HStack {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("Logged in")
                    .foregroundStyle(.secondary)
            }
        case .failed(let message):
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundStyle(.red)
                    Text("Authentication failed")
                }
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Try Again", action: onLogin)
                    .controlSize(.small)
            }
        }
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
