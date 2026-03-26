import AppKit
import ComposableArchitecture
import Foundation

@Reducer
struct ProjectDetailFeature {
    @ObservableState
    struct State: Equatable {
        var project: Project
        var workflow: WorkflowDocument?
        var isLoading = true

        var modelRegistry: ModelRegistry?
        var authProviders: [AuthProvider] = []
        var selectedProviderId: String?
        var selectedModelId: String?
        var authState: AuthState = .idle

        enum AuthState: Equatable {
            case idle
            case authenticating
            case waitingForCode(message: String, placeholder: String?)
            case success
            case failed(String)
        }

        var selectedProvider: ModelProvider? {
            guard let id = selectedProviderId else { return nil }
            return modelRegistry?.providers.first { $0.id == id }
        }

        var isProviderAuthenticated: Bool {
            guard let id = selectedProviderId else { return false }
            return authProviders.first { $0.id == id }?.authenticated ?? false
        }
    }

    enum Action {
        case task
        case workflowLoaded(WorkflowDocument?)
        case createWorkflow(WorkflowTemplate)
        case updateFrontmatter(WorkflowFrontmatter)
        case save
        case saved(Bool)
        case openInEditor

        case modelsLoaded(ModelRegistry)
        case authStatusLoaded([AuthProvider])
        case selectProvider(String)
        case selectModel(String)
        case loginTapped
        case authCodeSubmitted(String)
        case authURLReceived(String)
        case authPromptReceived(AuthPrompt)
        case authCompleted
        case authFailed(String)
    }

    enum WorkflowTemplate: String, CaseIterable {
        case github
        case beads
        case blank
    }

    enum CancelID: Hashable {
        case authLogin
    }

    @Dependency(\.fileClient) var fileClient
    @Dependency(\.plotCLI) var plotCLI

    var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .task:
                return .merge(
                    .run { [path = state.project.path] send in
                        let doc = try await fileClient.readWorkflow(path)
                        await send(.workflowLoaded(doc))
                    },
                    .run { send in
                        if let registry = try? await plotCLI.listModels() {
                            await send(.modelsLoaded(registry))
                        }
                    },
                    .run { send in
                        if let providers = try? await plotCLI.authStatus() {
                            await send(.authStatusLoaded(providers))
                        }
                    }
                )

            case .workflowLoaded(let doc):
                state.workflow = doc
                state.isLoading = false
                if let model = doc?.config.agent?.model {
                    let parts = model.split(separator: "/", maxSplits: 1)
                    if parts.count == 2 {
                        state.selectedProviderId = String(parts[0])
                        state.selectedModelId = String(parts[1])
                    }
                }
                return .none

            case .modelsLoaded(let registry):
                state.modelRegistry = registry
                if state.selectedProviderId == nil, let model = state.workflow?.config.agent?.model {
                    let parts = model.split(separator: "/", maxSplits: 1)
                    if parts.count == 2 {
                        state.selectedProviderId = String(parts[0])
                        state.selectedModelId = String(parts[1])
                    }
                }
                return .none

            case .authStatusLoaded(let providers):
                state.authProviders = providers
                return .none

            case .selectProvider(let id):
                state.selectedProviderId = id
                state.selectedModelId = state.modelRegistry?.providers
                    .first { $0.id == id }?.models.first?.id
                syncModelToFrontmatter(&state)
                return .none

            case .selectModel(let id):
                state.selectedModelId = id
                syncModelToFrontmatter(&state)
                return .none

            case .loginTapped:
                guard let providerId = state.selectedProviderId else { return .none }
                state.authState = .authenticating
                return .run { send in
                    do {
                        try await plotCLI.authLogin(
                            providerId,
                            { prompt in
                                await send(.authPromptReceived(prompt))
                                // wait for user to submit code — handled via continuation below
                                // for now, this blocks; we'll use a different pattern
                                return ""
                            },
                            { url in
                                await send(.authURLReceived(url))
                            }
                        )
                        await send(.authCompleted)
                    } catch {
                        await send(.authFailed(error.localizedDescription))
                    }
                }
                .cancellable(id: CancelID.authLogin)

            case .authURLReceived(let url):
                if let nsURL = URL(string: url) {
                    NSWorkspace.shared.open(nsURL)
                }
                return .none

            case .authPromptReceived(let prompt):
                state.authState = .waitingForCode(
                    message: prompt.message,
                    placeholder: prompt.placeholder
                )
                return .none

            case .authCodeSubmitted:
                state.authState = .authenticating
                return .none

            case .authCompleted:
                state.authState = .success
                return .run { send in
                    if let providers = try? await plotCLI.authStatus() {
                        await send(.authStatusLoaded(providers))
                    }
                }

            case .authFailed(let message):
                state.authState = .failed(message)
                return .none

            case .createWorkflow(let template):
                let doc = Self.templateDocument(for: template)
                state.workflow = doc
                return .run { [path = state.project.path] _ in
                    try await fileClient.writeWorkflow(path, doc)
                }

            case .updateFrontmatter(let frontmatter):
                state.workflow?.config = frontmatter
                return .none

            case .save:
                guard let workflow = state.workflow else { return .none }
                return .run { [path = state.project.path] send in
                    do {
                        try await fileClient.writeWorkflow(path, workflow)
                        await send(.saved(true))
                    } catch {
                        await send(.saved(false))
                    }
                }

            case .saved:
                return .none

            case .openInEditor:
                let filePath = (state.project.path as NSString).appendingPathComponent("WORKFLOW.md")
                return .run { _ in
                    await fileClient.openInEditor(filePath)
                }
            }
        }
    }

    private func syncModelToFrontmatter(_ state: inout State) {
        guard let provider = state.selectedProviderId,
              let model = state.selectedModelId else { return }
        let fullModel = "\(provider)/\(model)"
        if state.workflow?.config.agent == nil {
            state.workflow?.config.agent = .init(model: fullModel)
        } else {
            state.workflow?.config.agent?.model = fullModel
        }
    }

    static func templateDocument(for template: WorkflowTemplate) -> WorkflowDocument {
        switch template {
        case .github:
            return WorkflowDocument(
                config: WorkflowFrontmatter(
                    tracker: .init(
                        kind: "github",
                        dispatchStates: ["plot:todo", "plot:in-progress"],
                        parkedStates: ["plot:human-review"],
                        terminalStates: ["plot:done"]
                    ),
                    workspace: .init(root: "./workspaces"),
                    agent: .init(maxConcurrentAgents: 1, maxTurns: 50, model: "anthropic/claude-sonnet-4-20250514")
                ),
                promptBody: "## Instructions\n\nWork on the assigned issue only.\nKeep diffs minimal.\nProve changes with checks before claiming success."
            )
        case .beads:
            return WorkflowDocument(
                config: WorkflowFrontmatter(
                    tracker: .init(
                        kind: "beads",
                        dispatchStates: ["ready"],
                        terminalStates: ["closed"]
                    ),
                    workspace: .init(root: "./workspaces"),
                    agent: .init(maxConcurrentAgents: 1, maxTurns: 50, model: "anthropic/claude-sonnet-4-20250514")
                ),
                promptBody: "## Instructions\n\nWork on the assigned issue only.\nKeep diffs minimal."
            )
        case .blank:
            return WorkflowDocument(
                config: WorkflowFrontmatter(
                    tracker: .init(kind: "github")
                ),
                promptBody: ""
            )
        }
    }
}
